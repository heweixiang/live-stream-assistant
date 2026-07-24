/**
 * 统一 TTS 朗读入口：默认内置 MeloTTS，其次本机语音
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
/** 主进程播放互斥，避免叠音 */
let nativePlayLock: Promise<void> = Promise.resolve()

const MAX_QUEUE = 12

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

/** 渲染进程 Blob 播放（浏览器 / 主进程播放失败时兜底） */
async function playInRenderer(url: string, volume = 1, epoch: number) {
  if (epoch !== speakEpoch) return
  if (currentAudio) {
    try {
      currentAudio.pause()
    } catch {
      // ignore
    }
  }

  let objectUrl: string | null = null
  let src = url
  try {
    if (url.startsWith('data:')) {
      const blob = await (await fetch(url)).blob()
      objectUrl = URL.createObjectURL(blob)
      src = objectUrl
    }
  } catch {
    // 保留原 dataUrl
  }

  const audio = new Audio(src)
  currentAudio = audio
  audio.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1))
  // 渲染进程无法 >1，增益已在主进程 playAudioDataUrl 处理；此处兜底仍钳到 1
  try {
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
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        // ignore
      }
    }
  }
  if (epoch !== speakEpoch) return
}

/**
 * 优先主进程本机播放（Windows SoundPlayer / MediaPlayer），保证能出声
 */
async function playDataUrl(url: string, volume = 1, epoch: number) {
  if (epoch !== speakEpoch) return
  const api = window.liveAssistant
  if (api?.playAudioDataUrl) {
    const run = nativePlayLock.then(async () => {
      if (epoch !== speakEpoch) return
      const res = await api.playAudioDataUrl(url, volume)
      if (res && res.ok === false) {
        throw new Error(res.error || '本机播放失败')
      }
    })
    nativePlayLock = run.catch(() => undefined).then(() => undefined)
    try {
      await run
      return
    } catch (e) {
      console.warn('[tts] native play failed, fallback renderer', e)
    }
  }
  await playInRenderer(url, volume, epoch)
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
  const volume = Math.min(3, Math.max(0, opts?.volume ?? cfg.defaultVolume ?? 1))

  if (cfg.provider === 'melo') {
    const api = window.liveAssistant
    if (!api?.ttsSpeak) {
      const base = (cfg.meloUrl || 'http://127.0.0.1:8766').replace(/\/$/, '')
      const res = await fetch(`${base}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, speed: rate }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        dataUrl?: string
        error?: string
      }
      if (!res.ok || !data?.ok || !data?.dataUrl) {
        throw new Error(data?.error || `MeloTTS 失败 HTTP ${res.status}`)
      }
      if (epoch !== speakEpoch) return
      await playDataUrl(data.dataUrl, volume, epoch)
      return
    }
    if (epoch !== speakEpoch) return
    const res = await api.ttsSpeak({
      provider: 'melo',
      text: t,
      rate,
      volume,
      meloUrl: cfg.meloUrl,
    })
    if (epoch !== speakEpoch) return
    if (!res?.ok || !res.dataUrl) throw new Error(res?.error || 'MeloTTS 失败')
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
    // 直播高峰：静默丢弃，不抛错（否则弹幕/进场会刷「播报失败」）
    return
  }
  queueDepth += 1
  let taskError: unknown = null
  const task = speakChain
    .then(async () => {
      if (epoch !== speakEpoch) return
      await speakOnce(t, opts, epoch)
    })
    .catch((e) => {
      taskError = e
    })
    .finally(() => {
      queueDepth = Math.max(0, queueDepth - 1)
    })
  speakChain = task.then(() => undefined)
  await task
  if (taskError) throw taskError
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
