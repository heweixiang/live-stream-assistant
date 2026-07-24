/**
 * 整蛊/玩法规则模型
 *
 * 架构分层：
 * 1. Trigger  — 直播事件何时触发（弹幕/礼物/点赞/进场…）
 * 2. Effect   — 触发后如何调度动作（顺序/同时/随机）
 * 3. Action   — 具体对软硬件、媒体、OBS、系统的操作
 *
 * 执行链路：LiveEvent → rulesEngine.match → actionRunner.runRule →
 *           渲染层（音视频） / Electron 主进程（键鼠、进程、关机等）
 */

/** 触发条件类型（与直播事件对齐；未接入的先占位） */
export type TriggerKind =
  | 'chat'
  | 'gift'
  | 'gift_value'
  | 'gift_value_sum'
  | 'like'
  | 'like_total'
  | 'follow'
  | 'enter'
  | 'fan_club'
  | 'fan_level'
  | 'share'
  | 'recommend'

export interface RuleTrigger {
  kind: TriggerKind
  /** 弹幕关键词 */
  keywords?: string[]
  /** 指定礼物名（精确匹配；由礼物目录下拉选择） */
  giftName?: string
  /** 礼物数量阈值 */
  giftCount?: number
  /** 单次礼物价值 / 累计礼物价值 */
  minValue?: number
  /** 单次点赞数阈值 */
  likeCount?: number
  /** 房间点赞总数阈值 */
  likeTotal?: number
  /** 按礼物数量连触多次 */
  multiByGiftCount?: boolean
  /** 连触间隔（秒） */
  multiIntervalSec?: number
  /** 同用户冷却（秒），0=不限制 */
  userCooldownSec?: number
}

export type EffectMode = 'sequential' | 'parallel' | 'random'

export type ActionCategory =
  | 'keyboard'
  | 'mouse'
  | 'sound'
  | 'video'
  | 'desktop_video'
  | 'key_replay'
  | 'obs_source'
  | 'obs_filter'
  | 'hardware'
  | 'other'

export type MouseOp =
  | 'click_left'
  | 'click_right'
  | 'click_middle'
  | 'move'
  | 'scroll'
  /** 从起点螺旋/乱晃移动到终点，制造天旋地转感 */
  | 'dizzy'
export type SoundMode = 'file' | 'tts'
export type OtherOp =
  | 'toast'
  | 'notify'
  | 'close_process'
  | 'minimize_process'
  | 'show_desktop'
  | 'stop_stream'
  | 'shutdown'
  | 'restart'

export interface RuleAction {
  id: string
  category: ActionCategory
  /** 是否参与触发；默认 true，未勾选则跳过 */
  enabled?: boolean
  /** 开始前延迟（秒） */
  delayStartSec: number
  /** 结束后再等（秒），用于顺序队列间距 */
  delayEndSec: number
  // —— 键盘 ——
  keys?: string
  keyHoldSec?: number
  keyRepeat?: number
  keyIntervalSec?: number
  // —— 鼠标 ——
  mouseOp?: MouseOp
  mouseX?: number
  mouseY?: number
  /** 天旋地转终点 X */
  mouseX2?: number
  /** 天旋地转终点 Y */
  mouseY2?: number
  /** 天旋地转总耗时（秒） */
  mouseDurationSec?: number
  /** 螺旋圈数，越大越晕，默认 4 */
  mouseSpinTurns?: number
  scrollDelta?: number
  // —— 音视频 ——
  /** file=本地音频；tts=系统语音朗读文本 */
  soundMode?: SoundMode
  mediaPath?: string
  /** TTS 朗读内容 */
  ttsText?: string
  /** TTS 语速 0.5~2，默认 1 */
  ttsRate?: number
  /** TTS 音量 0~3，>1 为增益放大，默认 1 */
  ttsVolume?: number
  // —— OBS（占位，后续接 WebSocket） ——
  obsSourceName?: string
  obsFilterName?: string
  obsVisible?: boolean
  // —— 硬件（占位） ——
  hardwareId?: string
  hardwarePayload?: string
  // —— 其他 ——
  otherOp?: OtherOp
  processName?: string
  message?: string
  /** 弹窗提示显示多久后关闭（秒），默认 3 */
  toastCloseSec?: number
}

export interface PrankRule {
  id: string
  name: string
  enabled: boolean
  /** 快捷键触发（展示用，主进程热键后续接） */
  hotkey?: string
  trigger: RuleTrigger
  effectMode: EffectMode
  actions: RuleAction[]
  /** 规则级冷却（秒） */
  cooldownSec: number
}

export interface FiredAction {
  id: string
  ruleId: string
  ruleName: string
  message: string
  at: number
  /** 弹窗显示时长（毫秒），缺省约 3.2s */
  durationMs?: number
}

export const TRIGGER_OPTIONS: { value: TriggerKind; label: string; ready: boolean }[] = [
  { value: 'chat', label: '弹幕', ready: true },
  { value: 'gift', label: '礼物', ready: true },
  { value: 'gift_value', label: '礼物价值', ready: true },
  { value: 'gift_value_sum', label: '累计礼物价值', ready: true },
  { value: 'like', label: '点赞', ready: true },
  { value: 'like_total', label: '点赞总数', ready: true },
  { value: 'follow', label: '关注', ready: true },
  { value: 'enter', label: '进场', ready: true },
  { value: 'fan_club', label: '加入粉丝团', ready: false },
  { value: 'fan_level', label: '粉丝团升级', ready: false },
  { value: 'recommend', label: '推荐直播间', ready: false },
  { value: 'share', label: '分享直播间', ready: false },
]

export const ACTION_CATEGORIES: {
  value: ActionCategory
  label: string
  desc: string
  ready: boolean
}[] = [
  { value: 'keyboard', label: '键盘', desc: '模拟按键 / 组合键', ready: true },
  { value: 'mouse', label: '鼠标', desc: '点击、移动、滚轮', ready: true },
  { value: 'sound', label: '播放声音', desc: 'MP3 音效或 TTS 朗读', ready: true },
  { value: 'other', label: '系统操作', desc: '关进程 / 回桌面 / 关机等', ready: true },
  { value: 'video', label: '视频', desc: '待接入', ready: false },
  { value: 'desktop_video', label: '桌面视频', desc: '待接入', ready: false },
  { value: 'key_replay', label: '按键回放', desc: '待接入', ready: false },
  { value: 'obs_source', label: 'OBS来源', desc: '待接入', ready: false },
  { value: 'obs_filter', label: 'OBS滤镜', desc: '待接入', ready: false },
  { value: 'hardware', label: '控制硬件', desc: '待接入', ready: false },
]

export function newActionId() {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function newRuleId() {
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createEmptyAction(category: ActionCategory = 'keyboard'): RuleAction {
  return {
    id: newActionId(),
    category,
    enabled: true,
    delayStartSec: 0,
    delayEndSec: 0,
    keys: '',
    keyHoldSec: 0.05,
    keyRepeat: 1,
    keyIntervalSec: 0.1,
    mouseOp: 'click_left',
    mouseX: 0,
    mouseY: 0,
    mouseX2: 400,
    mouseY2: 300,
    mouseDurationSec: 2,
    mouseSpinTurns: 4,
    soundMode: 'file',
    mediaPath: '',
    ttsText: '整蛊触发',
    ttsRate: 1,
    ttsVolume: 1,
    otherOp: 'toast',
    message: '整蛊触发',
    toastCloseSec: 3,
    processName: '',
  }
}

export function createEmptyRule(name = '新玩法'): PrankRule {
  return {
    id: newRuleId(),
    name,
    enabled: true,
    hotkey: '',
    trigger: {
      kind: 'gift',
      giftName: '',
      giftCount: 1,
      keywords: [],
      minValue: 1,
      likeCount: 1,
      likeTotal: 1000,
      multiByGiftCount: false,
      multiIntervalSec: 1,
      userCooldownSec: 0,
    },
    effectMode: 'sequential',
    actions: [
      {
        ...createEmptyAction('other'),
        otherOp: 'toast',
        message: `${name}已触发`,
      },
    ],
    cooldownSec: 3,
  }
}

export function actionSummary(action: RuleAction): string {
  switch (action.category) {
    case 'keyboard':
      return `按键 ${action.keys || '（未设）'}`
    case 'mouse': {
      const map: Record<MouseOp, string> = {
        click_left: '左键单击',
        click_right: '右键单击',
        click_middle: '中键单击',
        move: '移动到指定位置',
        scroll: '滚轮',
        dizzy: `天旋地转 ${action.mouseDurationSec ?? 2}s`,
      }
      return map[action.mouseOp || 'click_left']
    }
    case 'sound': {
      const mode = action.soundMode || (action.mediaPath ? 'file' : action.ttsText ? 'tts' : 'file')
      if (mode === 'tts') {
        const t = (action.ttsText || '').trim()
        return t ? `TTS「${t.length > 16 ? `${t.slice(0, 16)}…` : t}」` : 'TTS（未填文本）'
      }
      return action.mediaPath ? `音效 ${fileName(action.mediaPath)}` : '音效（未选文件）'
    }
    case 'video':
      return '视频（待接入）'
    case 'desktop_video':
      return '桌面视频（待接入）'
    case 'key_replay':
      return '按键回放（待接入）'
    case 'obs_source':
      return `OBS来源 ${action.obsSourceName || '（未设）'}`
    case 'obs_filter':
      return `OBS滤镜 ${action.obsFilterName || '（未设）'}`
    case 'hardware':
      return '控制硬件（待接入）'
    case 'other': {
      const map: Record<OtherOp, string> = {
        toast: '弹窗提示',
        notify: '系统通知',
        close_process: `关闭程序 ${action.processName || '（未填）'}`.trim(),
        minimize_process: `最小化 ${action.processName || '（未填）'}`.trim(),
        show_desktop: '返回桌面',
        stop_stream: '自动下播（占位）',
        shutdown: '关机',
        restart: '重启',
      }
      return map[action.otherOp || 'toast']
    }
    default:
      return action.category
  }
}

function fileName(p: string) {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}
