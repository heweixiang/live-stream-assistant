/** TTS 系统设置（内置 Melo / 本机） */

export type TtsProvider = 'melo' | 'system'

export type TtsSettings = {
  provider: TtsProvider
  /** 朗读时是否优先用克隆音色（预留，当前仅录音样本管理） */
  useClone: boolean
  /** 默认语速 0.5~2 */
  defaultRate: number
  /** 默认音量 0~1 */
  defaultVolume: number
  /** MeloTTS 服务地址，默认本机 8766 */
  meloUrl: string
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  provider: 'melo',
  useClone: false,
  defaultRate: 1,
  defaultVolume: 1,
  meloUrl: 'http://127.0.0.1:8766',
}

const KEY = 'live-assistant.ttsSettings'

function normalizeProvider(p: unknown): TtsProvider {
  if (p === 'system') return 'system'
  // 旧版 azure 一律落到 melo
  return 'melo'
}

export function loadTtsSettings(): TtsSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_TTS_SETTINGS }
    const p = JSON.parse(raw) as Partial<TtsSettings> & { azureKey?: string }
    return {
      ...DEFAULT_TTS_SETTINGS,
      provider: normalizeProvider(p.provider),
      useClone: !!p.useClone,
      defaultRate: clamp(p.defaultRate, 0.5, 2, 1),
      defaultVolume: clamp(p.defaultVolume, 0, 3, 1),
      meloUrl: String(p.meloUrl || DEFAULT_TTS_SETTINGS.meloUrl).replace(/\/$/, ''),
    }
  } catch {
    return { ...DEFAULT_TTS_SETTINGS }
  }
}

export function saveTtsSettings(s: TtsSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    void import('../diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

function clamp(n: unknown, min: number, max: number, fallback: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

export type VoiceSampleMeta = {
  id: string
  name: string
  /** 相对/绝对路径，由主进程返回 */
  path: string
  createdAt: number
  durationSec?: number
  bytes?: number
}
