/** TTS / 语音克隆 系统设置 */

export type TtsProvider = 'system' | 'azure'

export type TtsSettings = {
  provider: TtsProvider
  /** Azure Speech 密钥 */
  azureKey: string
  /** 区域，如 eastasia / chinanorth3 */
  azureRegion: string
  /** 预置神经音色 */
  azureVoice: string
  /**
   * 语音克隆：Azure Personal Voice 的 speakerProfileId
   * 在 Speech Studio / API 创建后填入；有值且启用克隆时优先用它
   */
  speakerProfileId: string
  /** 个人音色基底模型名 */
  personalVoiceName: string
  /** 朗读时是否优先用克隆音色 */
  useClone: boolean
  /** 默认语速 0.5~2 */
  defaultRate: number
  /** 默认音量 0~1 */
  defaultVolume: number
}

export const AZURE_VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓（女·温柔）' },
  { value: 'zh-CN-XiaoyiNeural', label: '晓伊（女）' },
  { value: 'zh-CN-YunxiNeural', label: '云希（男·年轻）' },
  { value: 'zh-CN-YunyangNeural', label: '云扬（男·播报）' },
  { value: 'zh-CN-YunjianNeural', label: '云健（男）' },
  { value: 'zh-CN-XiaochenNeural', label: '晓辰（女）' },
  { value: 'zh-CN-XiaohanNeural', label: '晓涵（女）' },
  { value: 'zh-CN-XiaomengNeural', label: '晓梦（女）' },
  { value: 'zh-CN-XiaomoNeural', label: '晓墨（女）' },
  { value: 'zh-CN-XiaoqiuNeural', label: '晓秋（女）' },
  { value: 'zh-CN-XiaoruiNeural', label: '晓睿（女）' },
  { value: 'zh-CN-XiaoshuangNeural', label: '晓双（女·童声）' },
  { value: 'zh-CN-XiaoxuanNeural', label: '晓萱（女）' },
  { value: 'zh-CN-XiaozhenNeural', label: '晓甄（女）' },
  { value: 'zh-CN-YunfengNeural', label: '云枫（男）' },
  { value: 'zh-CN-YunhaoNeural', label: '云皓（男）' },
  { value: 'zh-CN-YunxiaNeural', label: '云夏（男·童声）' },
  { value: 'zh-CN-YunyeNeural', label: '云野（男）' },
  { value: 'zh-CN-YunzeNeural', label: '云泽（男）' },
]

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  provider: 'azure',
  azureKey: '',
  azureRegion: 'eastasia',
  azureVoice: 'zh-CN-XiaoxiaoNeural',
  speakerProfileId: '',
  personalVoiceName: 'DragonLatestNeural',
  useClone: false,
  defaultRate: 1,
  defaultVolume: 1,
}

const KEY = 'live-assistant.ttsSettings'

export function loadTtsSettings(): TtsSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_TTS_SETTINGS }
    const p = JSON.parse(raw) as Partial<TtsSettings>
    return {
      ...DEFAULT_TTS_SETTINGS,
      ...p,
      provider: p.provider === 'system' ? 'system' : 'azure',
      azureKey: String(p.azureKey || ''),
      azureRegion: String(p.azureRegion || DEFAULT_TTS_SETTINGS.azureRegion),
      azureVoice: String(p.azureVoice || DEFAULT_TTS_SETTINGS.azureVoice),
      speakerProfileId: String(p.speakerProfileId || ''),
      personalVoiceName: String(p.personalVoiceName || DEFAULT_TTS_SETTINGS.personalVoiceName),
      useClone: !!p.useClone,
      defaultRate: clamp(p.defaultRate, 0.5, 2, 1),
      defaultVolume: clamp(p.defaultVolume, 0, 1, 1),
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
