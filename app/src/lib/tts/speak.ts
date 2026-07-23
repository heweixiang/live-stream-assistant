/**
 * 统一 TTS 朗读入口：优先系统设置里的微软 Azure，其次本机语音
 */
import type { RuleAction } from '../prank/model'
import { loadTtsSettings } from './settings'

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/** 打断代数：stopSpeak 后旧任务全部作废 */
let speakEpoch = 0
let speakChain: Promise<void> = Promise.resolve()
let queueDepth = 0
let currentAudio: HTMLAudioElement | null = null

const MAX_QUEUE = 4

export function stopSpeak() {
  speakEpoch += 1
  queueDepth = 0
  speakChain = Promise.resolve()
  try {
    window.speechSynthesis?.cancel()
  } catch {
    // ignore
  }
  if (currentAudio) {
    try {
      currentAudio.pause()
      currentAudio.src = ''
    } catch {
      // ignore
    }
    currentAudio = null
  }
}

export function isSpeakBusy() {
  return queueDepth > 0 || !!currentAudio
}

async function playDataUrl(url: string, volume = 1, epoch: number) {
  if (epoch !== speakEpoch) return
  if (currentAudio) {
    try {
      currentAudio.pause()
    } catch {
      // ignore
    }
  }
  const audio = new Audio(url)
  currentAudio = audio
  audio.volume = Math.min(1, Math.max(0, volume))
  await audio.play()
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    audio.onerror = () => {
      if (currentAudio === audio) currentAudio = null
      reject(new Error('音频播放失败'))
    }
  })
  if (epoch !== speakEpoch) return
}

async function speakSystem(text: string, rate: number, volume: number, epoch: number) {
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  if (synth) {
    await new Promise<void>((resolve, reject) => {
      try {
        if (epoch !== speakEpoch) {
          resolve()
          return
        }
        synth.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'zh-CN'
        u.rate = rate
        u.volume = volume
        u.onend = () => resolve()
        u.onerror = () => reject(new Error('本机 TTS 失败'))
        synth.speak(u)
      } catch (e) {
        reject(e)
      }
    })
    return
  }
  const api = window.liveAssistant
  if (!api?.runAction) throw new Error('无可用 TTS')
  await api.runAction({
    id: 'tts-tmp',
    category: 'sound',
    soundMode: 'tts',
    ttsText: text,
    ttsRate: rate,
    ttsVolume: volume,
    delayStartSec: 0,
    delayEndSec: 0,
  })
}

async function speakOnce(text: string, opts: { rate?: number; volume?: number } | undefined, epoch: number) {
  if (epoch !== speakEpoch) return
  const t = (text || '').trim()
  if (!t) return

  const cfg = loadTtsSettings()
  const rate = Math.min(2, Math.max(0.5, opts?.rate ?? cfg.defaultRate ?? 1))
  const volume = Math.min(1, Math.max(0, opts?.volume ?? cfg.defaultVolume ?? 1))

  if (cfg.provider === 'azure') {
    const key = cfg.azureKey.trim()
    const region = cfg.azureRegion.trim()
    if (!key || !region) {
      await speakSystem(t, rate, volume, epoch)
      return
    }
    const api = window.liveAssistant
    if (!api?.ttsSpeak) {
      await speakSystem(t, rate, volume, epoch)
      return
    }
    if (epoch !== speakEpoch) return
    const res = await api.ttsSpeak({
      text: t,
      rate,
      volume,
      key,
      region,
      voice: cfg.azureVoice,
      useClone: cfg.useClone && !!cfg.speakerProfileId.trim(),
      speakerProfileId: cfg.speakerProfileId.trim(),
      personalVoiceName: cfg.personalVoiceName || 'DragonLatestNeural',
    })
    if (epoch !== speakEpoch) return
    if (!res?.ok || !res.dataUrl) throw new Error(res?.error || 'Azure TTS 失败')
    await playDataUrl(res.dataUrl, volume, epoch)
    return
  }

  await speakSystem(t, rate, volume, epoch)
}

/**
 * 朗读文本。queue=true 时限长排队；满了会丢掉新请求，避免播报停不下来。
 */
export async function speakText(
  text: string,
  opts?: { rate?: number; volume?: number; queue?: boolean },
): Promise<void> {
  const t = (text || '').trim()
  if (!t) return
  const useQueue = opts?.queue !== false
  const epoch = speakEpoch

  if (!useQueue) {
    stopSpeak()
    const ep = speakEpoch
    queueDepth = 1
    try {
      await speakOnce(t, opts, ep)
    } finally {
      if (speakEpoch === ep) queueDepth = Math.max(0, queueDepth - 1)
    }
    return
  }

  if (queueDepth >= MAX_QUEUE) {
    // 队列过长：丢掉，防止无限念
    return
  }
  queueDepth += 1
  speakChain = speakChain
    .then(async () => {
      if (epoch !== speakEpoch) return
      await speakOnce(t, opts, epoch)
    })
    .catch(() => undefined)
    .finally(() => {
      queueDepth = Math.max(0, queueDepth - 1)
    })
  await speakChain
}

export async function speakFromAction(action: RuleAction) {
  const text = (action.ttsText || '').trim()
  if (!text) return
  await speakText(text, {
    rate: action.ttsRate,
    volume: action.ttsVolume,
    queue: true,
  })
  await sleep(30)
}
