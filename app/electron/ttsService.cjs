const fs = require('fs')
const path = require('path')
const { clonesDir: dataClonesDir } = require('./dataStore.cjs')

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 语速 0.5~2 → SSML percentage，如 1 → +0%，1.2 → +20% */
function rateToProsody(rate) {
  const r = Math.min(2, Math.max(0.5, Number(rate) || 1))
  const pct = Math.round((r - 1) * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

function buildSsml({ text, voice, rate, useClone, speakerProfileId, personalVoiceName }) {
  const body = xmlEscape(text)
  const prosodyRate = rateToProsody(rate)
  if (useClone && speakerProfileId) {
    const base = personalVoiceName || 'DragonLatestNeural'
    return `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN">
  <voice name="${xmlEscape(base)}">
    <mstts:ttsembedding speakerProfileId="${xmlEscape(speakerProfileId)}">
      <prosody rate="${prosodyRate}">${body}</prosody>
    </mstts:ttsembedding>
  </voice>
</speak>`
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">
  <voice name="${xmlEscape(voice || 'zh-CN-XiaoxiaoNeural')}">
    <prosody rate="${prosodyRate}">${body}</prosody>
  </voice>
</speak>`
}

/**
 * @param {{ text: string, key: string, region: string, voice?: string, rate?: number, volume?: number, useClone?: boolean, speakerProfileId?: string, personalVoiceName?: string }} opts
 */
async function azureSpeak(opts) {
  const text = String(opts.text || '').trim()
  const key = String(opts.key || '').trim()
  const region = String(opts.region || '').trim()
  if (!text) throw new Error('朗读文本为空')
  if (!key) throw new Error('未填写 Azure Speech 密钥')
  if (!region) throw new Error('未填写 Azure 区域')

  const ssml = buildSsml(opts)
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'LiveAssistant/0.1',
    },
    body: ssml,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Azure TTS ${res.status}: ${errText.slice(0, 240) || res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  return {
    ok: true,
    dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}`,
    bytes: buf.length,
  }
}

function clonesDir() {
  const dir = dataClonesDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function metaPath() {
  return path.join(clonesDir(), 'samples.json')
}

function loadMeta() {
  try {
    const p = metaPath()
    if (!fs.existsSync(p)) return []
    const list = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function saveMeta(list) {
  fs.writeFileSync(metaPath(), JSON.stringify(list, null, 2), 'utf8')
}

/**
 * 保存录音样本（base64 webm/wav）
 * @param {{ name?: string, base64: string, mime?: string, durationSec?: number }} payload
 */
function saveVoiceSample(payload) {
  const mime = String(payload.mime || 'audio/webm')
  const ext = mime.includes('wav') ? 'wav' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'webm'
  const id = `sample-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const file = path.join(clonesDir(), `${id}.${ext}`)
  const b64 = String(payload.base64 || '').replace(/^data:[^;]+;base64,/, '')
  if (!b64) throw new Error('录音数据为空')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 200) throw new Error('录音太短')
  if (buf.length > 30 * 1024 * 1024) throw new Error('录音过大（>30MB）')
  fs.writeFileSync(file, buf)
  const list = loadMeta()
  const item = {
    id,
    name: String(payload.name || `录音 ${new Date().toLocaleString()}`),
    path: file,
    createdAt: Date.now(),
    durationSec: Number(payload.durationSec) || undefined,
    bytes: buf.length,
  }
  list.unshift(item)
  saveMeta(list.slice(0, 50))
  return item
}

function listVoiceSamples() {
  const list = loadMeta()
  return list.filter((x) => x?.path && fs.existsSync(x.path))
}

function deleteVoiceSample(id) {
  const list = loadMeta()
  const hit = list.find((x) => x.id === id)
  if (hit?.path && fs.existsSync(hit.path)) {
    try {
      fs.unlinkSync(hit.path)
    } catch {
      // ignore
    }
  }
  saveMeta(list.filter((x) => x.id !== id))
  return true
}

function readVoiceSampleDataUrl(id) {
  const hit = listVoiceSamples().find((x) => x.id === id)
  if (!hit) throw new Error('样本不存在')
  const buf = fs.readFileSync(hit.path)
  const ext = path.extname(hit.path).toLowerCase()
  const mime =
    ext === '.wav'
      ? 'audio/wav'
      : ext === '.m4a'
        ? 'audio/mp4'
        : 'audio/webm'
  return `data:${mime};base64,${buf.toString('base64')}`
}

module.exports = {
  azureSpeak,
  saveVoiceSample,
  listVoiceSamples,
  deleteVoiceSample,
  readVoiceSampleDataUrl,
  clonesDir,
}
