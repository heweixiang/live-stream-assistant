/** 直播复盘：单场会话与可记录事件类型 */

export type ReplayEventKind =
  | 'chat'
  | 'gift'
  | 'enter'
  | 'like'
  | 'follow'
  | 'fansclub_join'
  | 'fansclub_upgrade'
  | 'prank'
  | 'room'
  | 'status'

export type ReplayConfig = {
  /** 总开关：是否在监听时自动录制 */
  enabled: boolean
  /** 各类是否写入复盘（下播后可回看） */
  recordChat: boolean
  recordGift: boolean
  recordEnter: boolean
  recordLike: boolean
  recordFollow: boolean
  recordFansclub: boolean
  recordPrank: boolean
  recordRoom: boolean
  /** 单场最多保留事件条数（防爆盘） */
  maxEventsPerSession: number
  /** 历史场次最多保留多少场 */
  maxSessions: number
}

export const DEFAULT_REPLAY_CONFIG: ReplayConfig = {
  enabled: true,
  recordChat: true,
  recordGift: true,
  recordEnter: false,
  recordLike: false,
  recordFollow: true,
  recordFansclub: true,
  recordPrank: true,
  recordRoom: true,
  maxEventsPerSession: 8000,
  maxSessions: 40,
}

export type ReplayEvent = {
  kind: ReplayEventKind
  at: number
  user?: string
  content?: string
  giftName?: string
  giftCount?: number
  giftValue?: number
  giftIcon?: string
  likeCount?: number
  /** 整蛊 */
  ruleId?: string
  ruleName?: string
  message?: string
  /** 房间人数等 */
  online?: number
  likeTotal?: number
}

export type ReplaySessionSummary = {
  id: string
  liveId: string
  title: string
  startedAt: number
  endedAt: number
  durationSec: number
  totals: ReplayTotals
  eventCount: number
}

export type ReplayTotals = {
  chat: number
  gift: number
  giftValue: number
  enter: number
  like: number
  likeUsers: number
  follow: number
  fansclubJoin: number
  fansclubUpgrade: number
  prank: number
  /** 整蛊按规则名计数 */
  prankByRule: Record<string, number>
  peakOnline: number
}

export type ReplaySession = ReplaySessionSummary & {
  events: ReplayEvent[]
}

export function emptyTotals(): ReplayTotals {
  return {
    chat: 0,
    gift: 0,
    giftValue: 0,
    enter: 0,
    like: 0,
    likeUsers: 0,
    follow: 0,
    fansclubJoin: 0,
    fansclubUpgrade: 0,
    prank: 0,
    prankByRule: {},
    peakOnline: 0,
  }
}

export function newReplaySessionId(ts = Date.now()) {
  return `rp-${ts.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}
