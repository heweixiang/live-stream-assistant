/**
 * 语音播报：按直播事件朗读模板（支持占位符）
 */

import type { LiveEvent } from '../../types'

export type AnnounceKind = 'gift' | 'chat' | 'enter' | 'follow' | 'like'

export type AnnounceRule = {
  kind: AnnounceKind
  enabled: boolean
  /** 模板，如：感谢【UserName】老板送出的【礼物】x【数量】 */
  template: string
}

export type AnnounceSettings = {
  /** 总开关 */
  enabled: boolean
  /** 排队朗读，避免叠音 */
  queue: boolean
  /**
   * 点赞按秒聚合：每 N 秒汇总窗口内点赞（同用户合并数量）再播报/触发
   */
  likeMergeSec: number
  rules: AnnounceRule[]
}

/** 可拖入模板的占位符 */
export const ANNOUNCE_PLACEHOLDERS: {
  token: string
  label: string
  desc: string
  /** 适用于哪些事件；空=通用 */
  kinds?: AnnounceKind[]
}[] = [
  { token: '【UserName】', label: '用户名', desc: '送礼/发言的用户' },
  { token: '【礼物】', label: '礼物名', desc: '礼物名称', kinds: ['gift'] },
  { token: '【数量】', label: '数量', desc: '礼物个数', kinds: ['gift'] },
  { token: '【价值】', label: '价值', desc: '礼物价值', kinds: ['gift'] },
  { token: '【弹幕】', label: '弹幕', desc: '弹幕正文', kinds: ['chat'] },
  { token: '【点赞数】', label: '点赞数', desc: '本次点赞数', kinds: ['like'] },
]

export const ANNOUNCE_KIND_META: {
  kind: AnnounceKind
  label: string
  example: Record<string, string>
  defaultTemplate: string
}[] = [
  {
    kind: 'gift',
    label: '礼物',
    example: { UserName: '小明', 礼物: '为你闪耀', 数量: '5', 价值: '9' },
    defaultTemplate: '感谢【UserName】老板送出的【礼物】x【数量】',
  },
  {
    kind: 'chat',
    label: '弹幕',
    example: { UserName: '小红', 弹幕: '主播加油' },
    defaultTemplate: '【UserName】说：【弹幕】',
  },
  {
    kind: 'enter',
    label: '进场',
    example: { UserName: '访客001' },
    defaultTemplate: '欢迎【UserName】进入直播间',
  },
  {
    kind: 'follow',
    label: '关注',
    example: { UserName: '新粉小李' },
    defaultTemplate: '感谢【UserName】的关注',
  },
  {
    kind: 'like',
    label: '点赞',
    example: { UserName: '热心观众', 点赞数: '20' },
    defaultTemplate: '感谢【UserName】点了【点赞数】个赞',
  },
]

export const DEFAULT_ANNOUNCE_SETTINGS: AnnounceSettings = {
  enabled: false,
  queue: true,
  likeMergeSec: 4,
  rules: ANNOUNCE_KIND_META.map((m) => ({
    kind: m.kind,
    enabled: m.kind === 'gift',
    template: m.defaultTemplate,
  })),
}

const KEY = 'live-assistant.announceSettings'

function clampMergeSec(n: unknown) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 4
  return Math.min(60, Math.max(0.5, Math.round(v * 10) / 10))
}

/** 点赞聚合秒数（固定时间窗汇总 + 列表合并共用） */
export function getLikeMergeSec() {
  return clampMergeSec(loadAnnounceSettings().likeMergeSec)
}

export function loadAnnounceSettings(): AnnounceSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return structuredClone(DEFAULT_ANNOUNCE_SETTINGS)
    const p = JSON.parse(raw) as Partial<AnnounceSettings>
    const byKind = new Map((p.rules || []).map((r) => [r.kind, r]))
    return {
      enabled: !!p.enabled,
      queue: p.queue !== false,
      likeMergeSec: clampMergeSec(p.likeMergeSec ?? 4),
      rules: ANNOUNCE_KIND_META.map((m) => {
        const hit = byKind.get(m.kind)
        return {
          kind: m.kind,
          enabled: hit ? !!hit.enabled : m.kind === 'gift',
          template: (hit?.template || m.defaultTemplate).trim() || m.defaultTemplate,
        }
      }),
    }
  } catch {
    return structuredClone(DEFAULT_ANNOUNCE_SETTINGS)
  }
}

export function saveAnnounceSettings(s: AnnounceSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    void import('../diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

/** 把模板里的占位符替换成实际值 */
export function renderAnnounceTemplate(
  template: string,
  vars: Record<string, string | number | undefined>,
): string {
  let out = template || ''
  // 【Key】形式
  out = out.replace(/【([^】]+)】/g, (_m, key: string) => {
    const v = vars[key]
    if (v === undefined || v === null || v === '') return ''
    return String(v)
  })
  // 兼容 {user} / {gift} 等英文简写
  const aliases: Record<string, string> = {
    user: 'UserName',
    username: 'UserName',
    gift: '礼物',
    gift_name: '礼物',
    count: '数量',
    gift_count: '数量',
    value: '价值',
    gift_value: '价值',
    msg: '弹幕',
    content: '弹幕',
    likes: '点赞数',
    like: '点赞数',
  }
  out = out.replace(/\{([a-zA-Z_]+)\}/g, (_m, key: string) => {
    const mapped = aliases[key.toLowerCase()] || key
    const v = vars[mapped] ?? vars[key]
    if (v === undefined || v === null || v === '') return ''
    return String(v)
  })
  return out.replace(/\s{2,}/g, ' ').trim()
}

export function exampleVarsFor(kind: AnnounceKind): Record<string, string> {
  return { ...(ANNOUNCE_KIND_META.find((m) => m.kind === kind)?.example || {}) }
}

export function varsFromLiveEvent(event: LiveEvent): { kind: AnnounceKind; vars: Record<string, string> } | null {
  const user = (event.user || '观众').trim() || '观众'
  switch (event.type) {
    case 'gift':
      return {
        kind: 'gift',
        vars: {
          UserName: user,
          礼物: (event.gift_name || '礼物').trim() || '礼物',
          数量: String(
            event.extra?.combo_total ?? event.extra?.gift_delta ?? event.gift_count ?? 1,
          ),
          价值: String(event.gift_value ?? ''),
        },
      }
    case 'chat':
      return {
        kind: 'chat',
        vars: {
          UserName: user,
          弹幕: (event.content || '').trim(),
        },
      }
    case 'enter':
      return { kind: 'enter', vars: { UserName: user } }
    case 'follow':
      return { kind: 'follow', vars: { UserName: user } }
    case 'like': {
      const n =
        Number(event.extra?.count ?? event.extra?.like_count ?? event.content) ||
        Number(event.gift_count) ||
        1
      return {
        kind: 'like',
        vars: { UserName: user, 点赞数: String(n) },
      }
    }
    default:
      return null
  }
}

/** 根据设置尝试播报一条直播事件 */
export async function tryAnnounceEvent(event: LiveEvent): Promise<void> {
  const cfg = loadAnnounceSettings()
  if (!cfg.enabled) return
  const mapped = varsFromLiveEvent(event)
  if (!mapped) return
  const rule = cfg.rules.find((r) => r.kind === mapped.kind)
  if (!rule?.enabled) return
  const text = renderAnnounceTemplate(rule.template, mapped.vars)
  if (!text) return

  const { speakText } = await import('./speak')
  try {
    // 直播事件默认走排队；满了静默丢，避免刷失败提示
    await speakText(text, { queue: cfg.queue !== false })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/队列已满|已停止|abort/i.test(msg)) return
    console.warn('[announce] speak failed', e)
    try {
      await window.liveAssistant?.notify?.('语音播报失败', msg)
    } catch {
      // ignore
    }
  }
}

/** 停止所有播报（含排队） */
export async function stopAnnounceSpeak() {
  const { stopSpeak } = await import('./speak')
  stopSpeak()
}
