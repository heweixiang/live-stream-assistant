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

/**
 * 内置 MeloTTS（本地 HTTP 服务，默认 127.0.0.1:8766）
 * @param {{ text: string, rate?: number, meloUrl?: string }} opts
 */
async function meloSpeak(opts) {
  const text = String(opts.text || '').trim()
  if (!text) throw new Error('朗读文本为空')
  const base = String(opts.meloUrl || 'http://127.0.0.1:8766').replace(/\/$/, '')
  const speed = Math.min(2, Math.max(0.5, Number(opts.rate) || 1))
  let res
  try {
    res = await fetch(`${base}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, speed }),
    })
  } catch (e) {
    throw new Error(
      `无法连接内置 MeloTTS（${base}）。请先运行：npm run tts\n${e instanceof Error ? e.message : String(e)}`,
    )
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.ok || !data?.dataUrl) {
    throw new Error(data?.error || `MeloTTS 失败 HTTP ${res.status}`)
  }
  return { ok: true, dataUrl: data.dataUrl, bytes: data.bytes || 0 }
}

/**
 * 统一入口：按 provider 分发
 * @param {{ provider?: string, text: string, meloUrl?: string, key?: string, region?: string, voice?: string, rate?: number, volume?: number, useClone?: boolean, speakerProfileId?: string, personalVoiceName?: string }} opts
 */
async function speak(opts) {
  const provider = String(opts?.provider || 'melo')
  if (provider === 'melo') return meloSpeak(opts || {})
  if (provider === 'azure') return azureSpeak(opts || {})
  throw new Error(`不支持的 TTS 引擎：${provider}`)
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

/**
 * 对 PCM WAV 做增益（0~3）。SoundPlayer 无法调音量，>1 可把 Melo 合成声抬高。
 * @param {Buffer} buf
 * @param {number} gain
 */
function applyWavGain(buf, gain) {
  const g = Number(gain)
  if (!Buffer.isBuffer(buf) || buf.length < 44) return buf
  if (!Number.isFinite(g) || Math.abs(g - 1) < 0.001) return buf
  const out = Buffer.from(buf)
  let offset = 12
  while (offset + 8 <= out.length) {
    const id = out.toString('ascii', offset, offset + 4)
    const size = out.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    if (id === 'data') {
      const bits = out.readUInt16LE(34)
      const end = Math.min(dataStart + size, out.length)
      if (bits === 16) {
        for (let i = dataStart; i + 1 < end; i += 2) {
          let s = out.readInt16LE(i)
          s = Math.max(-32768, Math.min(32767, Math.round(s * g)))
          out.writeInt16LE(s, i)
        }
      } else if (bits === 8) {
        for (let i = dataStart; i < end; i++) {
          let s = (out[i] - 128) * g
          out[i] = Math.max(0, Math.min(255, Math.round(s + 128)))
        }
      }
      return out
    }
    offset = dataStart + size + (size % 2)
  }
  return buf
}

/**
 * 主进程本机播放（绕过 Chromium Audio，避免无声）
 * volume 支持 0~3：≤1 为常规音量，>1 对 wav 做增益放大（相对系统音量可更响）
 * @param {string} dataUrl
 * @param {number} [volume]
 */
async function playDataUrlNative(dataUrl, volume = 1) {
  const os = require('os')
  const { execFile } = require('child_process')
  const raw = String(dataUrl || '')
  const m = raw.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/i)
  if (!m?.[2]) throw new Error('无效音频数据')
  const mime = (m[1] || 'audio/wav').toLowerCase()
  const ext = mime.includes('mpeg') || mime.includes('mp3')
    ? 'mp3'
    : mime.includes('mp4') || mime.includes('m4a')
      ? 'm4a'
      : mime.includes('wav')
        ? 'wav'
        : mime.includes('webm')
          ? 'webm'
          : 'bin'
  const tmp = path.join(
    os.tmpdir(),
    `live-assistant-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
  )
  let audioBuf = Buffer.from(m[2], 'base64')
  const gain = Math.min(3, Math.max(0, Number(volume) || 1))
  if (ext === 'wav') {
    audioBuf = applyWavGain(audioBuf, gain)
  }
  fs.writeFileSync(tmp, audioBuf)
  // MediaPlayer 音量仅 0~1；wav 已用增益处理，这里固定 1
  const playerVol = ext === 'wav' ? 1 : Math.min(1, gain)
  const tmpPs = tmp.replace(/'/g, "''")

  // wav：SoundPlayer 最稳（音量靠上面的增益）；其它：WPF MediaPlayer
  const ps =
    ext === 'wav'
      ? `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$p = New-Object System.Media.SoundPlayer -ArgumentList '${tmpPs}'
$p.PlaySync()
`
      : `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
$p = New-Object System.Windows.Media.MediaPlayer
$p.Volume = ${playerVol}
$p.Open([Uri]::new('${tmpPs.replace(/\\/g, '/')}'))
$sw = [Diagnostics.Stopwatch]::StartNew()
while (-not $p.NaturalDuration.HasTimeSpan) {
  Start-Sleep -Milliseconds 40
  if ($sw.Elapsed.TotalSeconds -gt 10) { throw '音频打开超时' }
}
$p.Play()
Start-Sleep -Milliseconds ([Math]::Max(200, [int](($p.NaturalDuration.TimeSpan.TotalSeconds + 0.2) * 1000)))
$p.Close()
`

  try {
    await new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { windowsHide: true, timeout: 180000 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(String(stderr || err.message || err)))
          else resolve()
        },
      )
    })
    return { ok: true }
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // ignore
    }
  }
}

module.exports = {
  azureSpeak,
  meloSpeak,
  speak,
  playDataUrlNative,
  saveVoiceSample,
  listVoiceSamples,
  deleteVoiceSample,
  readVoiceSampleDataUrl,
  clonesDir,
}
