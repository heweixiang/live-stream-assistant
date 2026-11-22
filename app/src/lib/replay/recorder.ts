import type { LiveEvent } from '../../types'
import type { FiredAction } from '../prank/model'
import {
  emptyTotals,
  newReplaySessionId,
  type ReplayConfig,
  type ReplayEvent,
  type ReplaySession,
  type ReplaySessionSummary,
  type ReplayTotals,
} from './types'

/** 断线后多久内重连算同一场（毫秒） */
export const REPLAY_RESUME_GAP_MS = 20 * 60 * 1000

function applyEventToTotals(t: ReplayTotals, e: ReplayEvent) {
  switch (e.kind) {
    case 'chat':
      t.chat += 1
      break
    case 'gift':
      t.gift += Math.max(1, e.giftCount || 1)
      // giftValue 已是本条合计抖钻，不再乘数量
      t.giftValue += Math.max(0, e.giftValue || 0)
      break
    case 'enter':
      t.enter += 1
      break
    case 'like':
      t.like += Math.max(1, e.likeCount || 1)
      break
    case 'follow':
      t.follow += 1
      break
    case 'fansclub_join':
      t.fansclubJoin += 1
      break
    case 'fansclub_upgrade':
      t.fansclubUpgrade += 1
      break
    case 'prank': {
      t.prank += 1
      const name = e.ruleName || e.ruleId || '未知'
      t.prankByRule[name] = (t.prankByRule[name] || 0) + 1
      break
    }
    case 'room':
      if (e.online != null && e.online > t.peakOnline) t.peakOnline = e.online
      break
    default:
      break
  }
}

function eventAtMs(at: number) {
  if (!at) return 0
  return at > 1e12 ? at : at * 1000
}

/**
 * 清洗历史复盘：去掉抖音回放导致的重复礼物/整蛊/点赞，并重算 totals。
 */
export function normalizeReplaySession(session: ReplaySession): ReplaySession {
  const DEDUPE_MS = 5000
  const events: ReplayEvent[] = []
  for (const e of session.events || []) {
    const prev = events[events.length - 1]
    const dt = prev ? Math.abs(eventAtMs(e.at) - eventAtMs(prev.at)) : Infinity

    if (
      e.kind === 'gift' &&
      prev?.kind === 'gift' &&
      prev.user === e.user &&
      prev.giftName === e.giftName &&
      (prev.giftCount || 1) === (e.giftCount || 1) &&
      dt <= DEDUPE_MS
    ) {
      continue
    }

    // 礼物重复结算会连带打出两条相同整蛊
    if (
      e.kind === 'prank' &&
      prev?.kind === 'prank' &&
      prev.ruleName === e.ruleName &&
      prev.message === e.message &&
      dt <= DEDUPE_MS
    ) {
      continue
    }

    if (
      e.kind === 'like' &&
      prev?.kind === 'like' &&
      prev.user === e.user &&
      (prev.likeCount || 1) === (e.likeCount || 1) &&
      dt <= DEDUPE_MS
    ) {
      continue
    }

    events.push(e)
  }

  const totals = emptyTotals()
  const likeUsers = new Set<string>()
  for (const e of events) {
    if (e.kind === 'like' && e.user) likeUsers.add(e.user)
    applyEventToTotals(totals, e)
  }
  totals.likeUsers = likeUsers.size

  return {
    ...session,
    events,
    totals,
    eventCount: events.length,
  }
}

/** 进行中的复盘录制器（内存）；支持断线 20 分钟内同房续录 */
export class ReplayRecorder {
  session: ReplaySession | null = null
  /** 断线时刻；0=正在连着 */
  pausedAt = 0
  private cfg: ReplayConfig
  private likeUsers = new Set<string>()

  constructor(cfg: ReplayConfig) {
    this.cfg = cfg
  }

  updateConfig(cfg: ReplayConfig) {
    this.cfg = cfg
  }

  get active() {
    return !!this.session
  }

  get recording() {
    return !!this.session && !this.pausedAt
  }

  private startFresh(liveId: string) {
    const now = Date.now()
    const id = newReplaySessionId(now)
    this.likeUsers = new Set()
    this.pausedAt = 0
    this.session = {
      id,
      liveId: liveId || '',
      title: `直播 ${liveId || '未知'} · ${new Date(now).toLocaleString('zh-CN', { hour12: false })}`,
      startedAt: now,
      endedAt: 0,
      durationSec: 0,
      totals: emptyTotals(),
      eventCount: 0,
      events: [],
    }
  }

  /**
   * 已连接：同房号且断线间隔 ≤20 分钟 → 续同一场；否则收尾旧场并新开。
   * @returns 需要落盘的已结束场次（若有）
   */
  onConnected(liveId: string): ReplaySession | null {
    if (!this.cfg.enabled) return null
    const id = (liveId || '').trim()
    let finalized: ReplaySession | null = null

    if (this.session) {
      const sameRoom = (this.session.liveId || '') === id
      const gap = this.pausedAt ? Date.now() - this.pausedAt : 0
      if (sameRoom && this.pausedAt && gap <= REPLAY_RESUME_GAP_MS) {
        this.pausedAt = 0
        return null
      }
      if (sameRoom && !this.pausedAt) {
        // 已在录、未暂停：保持
        return null
      }
      finalized = this.finalize()
    }

    this.startFresh(id)
    return finalized
  }

  /** 断开 / 下播：暂停本场，等待可能的重连 */
  onDisconnected() {
    if (!this.session) return
    if (!this.pausedAt) this.pausedAt = Date.now()
  }

  /**
   * 直播间号变更：旧场收尾；新场等下次 connected 再开
   * @returns 需要落盘的旧场（若有）
   */
  onLiveIdChanged(liveId: string): ReplaySession | null {
    const id = (liveId || '').trim()
    if (!this.session) return null
    if ((this.session.liveId || '') === id) return null
    return this.finalize()
  }

  /** 暂停超过 20 分钟：强制收尾 */
  checkPauseTimeout(): ReplaySession | null {
    if (!this.session || !this.pausedAt) return null
    if (Date.now() - this.pausedAt <= REPLAY_RESUME_GAP_MS) return null
    return this.finalize()
  }

  /** 强制收尾并清空（应用退出等） */
  finalize(): ReplaySession | null {
    const s = this.session
    if (!s) return null
    const now = Date.now()
    s.endedAt = now
    s.durationSec = Math.max(0, Math.round((now - s.startedAt) / 1000))
    s.eventCount = s.events.length
    s.title = `${s.liveId || '直播'} · ${new Date(s.startedAt).toLocaleString('zh-CN', { hour12: false })}`
    this.session = null
    this.pausedAt = 0
    this.likeUsers = new Set()
    return s
  }

  /** 导出备份用：不结束本场，写入一份当前快照 */
  snapshotForExport(): ReplaySession | null {
    const s = this.session
    if (!s) return null
    const now = Date.now()
    return {
      ...s,
      events: s.events.slice(),
      totals: {
        ...s.totals,
        prankByRule: { ...s.totals.prankByRule },
      },
      endedAt: s.endedAt || now,
      durationSec: Math.max(0, Math.round(((s.endedAt || now) - s.startedAt) / 1000)),
      eventCount: s.events.length,
      title: s.endedAt
        ? s.title
        : `${s.liveId || '直播'} · 进行中备份 · ${new Date(s.startedAt).toLocaleString('zh-CN', { hour12: false })}`,
    }
  }

  pushLiveEvent(event: LiveEvent) {
    if (!this.cfg.enabled || !this.session) return
    const mapped = mapLiveEvent(event, this.cfg)
    if (!mapped) return
    this.append(mapped)
  }

  pushPrank(hit: FiredAction) {
    if (!this.cfg.enabled || !this.session || !this.cfg.recordPrank) return
    this.append({
      kind: 'prank',
      at: hit.at || Date.now(),
      ruleId: hit.ruleId,
      ruleName: hit.ruleName,
      message: hit.message,
      user: '',
      content: hit.message,
    })
  }

  private append(e: ReplayEvent) {
    const s = this.session
    if (!s) return
    if (e.kind === 'like' && e.user) {
      if (!this.likeUsers.has(e.user)) {
        this.likeUsers.add(e.user)
        s.totals.likeUsers = this.likeUsers.size
      }
    }
    applyEventToTotals(s.totals, e)
    s.events.push(e)
    s.eventCount = s.events.length
    const max = this.cfg.maxEventsPerSession
    if (s.events.length > max) {
      s.events.splice(0, s.events.length - max)
      s.eventCount = s.events.length
    }
  }
}

function mapLiveEvent(event: LiveEvent, cfg: ReplayConfig): ReplayEvent | null {
  const at = event.ts || Date.now()
  const user = event.user || ''

  if (event.type === 'chat') {
    if (!cfg.recordChat) return null
    return { kind: 'chat', at, user, content: event.content || '' }
  }
  if (event.type === 'gift') {
    if (!cfg.recordGift) return null
    return {
      kind: 'gift',
      at,
      user,
      giftName: event.gift_name || '',
      giftCount: event.gift_count || 1,
      giftValue: event.gift_value || 0,
      giftIcon: event.gift_icon || '',
      content: event.content || '',
    }
  }
  if (event.type === 'enter') {
    if (!cfg.recordEnter) return null
    return { kind: 'enter', at, user, content: event.content || '来了' }
  }
  if (event.type === 'like') {
    if (!cfg.recordLike) return null
    const n = Number(event.extra?.count) || 1
    return { kind: 'like', at, user, likeCount: n, content: event.content || '点赞了' }
  }
  if (event.type === 'follow') {
    if (!cfg.recordFollow) return null
    return { kind: 'follow', at, user, content: event.content || '关注了主播' }
  }
  if (event.type === 'notice' && event.extra?.kind === 'fansclub') {
    if (!cfg.recordFansclub) return null
    const t = Number(event.extra?.fansclub_type)
    return {
      kind: t === 1 ? 'fansclub_upgrade' : 'fansclub_join',
      at,
      user,
      content: event.content || '',
    }
  }
  if (event.type === 'room' && cfg.recordRoom) {
    const online = Number(event.extra?.online) || 0
    const likeTotal = Number(event.extra?.like_total) || 0
    if (!online && !likeTotal) return null
    return {
      kind: 'room',
      at,
      user: 'system',
      online: online || undefined,
      likeTotal: likeTotal || undefined,
      content: event.content || '',
    }
  }
  return null
}

export function toSummary(s: ReplaySession): ReplaySessionSummary {
  return {
    id: s.id,
    liveId: s.liveId,
    title: s.title,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationSec: s.durationSec,
    totals: s.totals,
    eventCount: s.eventCount,
  }
}

/** 两场对比：相对历史均值的增减 */
export function compareTotals(current: ReplayTotals, history: ReplayTotals[]) {
  const avg = emptyTotals()
  if (!history.length) {
    return { avg, deltas: emptyTotals() }
  }
  const n = history.length
  for (const h of history) {
    avg.chat += h.chat
    avg.gift += h.gift
    avg.giftValue += h.giftValue
    avg.enter += h.enter
    avg.like += h.like
    avg.likeUsers += h.likeUsers
    avg.follow += h.follow
    avg.fansclubJoin += h.fansclubJoin
    avg.fansclubUpgrade += h.fansclubUpgrade
    avg.prank += h.prank
    avg.peakOnline += h.peakOnline
  }
  avg.chat = Math.round(avg.chat / n)
  avg.gift = Math.round(avg.gift / n)
  avg.giftValue = Math.round(avg.giftValue / n)
  avg.enter = Math.round(avg.enter / n)
  avg.like = Math.round(avg.like / n)
  avg.likeUsers = Math.round(avg.likeUsers / n)
  avg.follow = Math.round(avg.follow / n)
  avg.fansclubJoin = Math.round(avg.fansclubJoin / n)
  avg.fansclubUpgrade = Math.round(avg.fansclubUpgrade / n)
  avg.prank = Math.round(avg.prank / n)
  avg.peakOnline = Math.round(avg.peakOnline / n)

  const deltas: ReplayTotals = {
    chat: current.chat - avg.chat,
    gift: current.gift - avg.gift,
    giftValue: current.giftValue - avg.giftValue,
    enter: current.enter - avg.enter,
    like: current.like - avg.like,
    likeUsers: current.likeUsers - avg.likeUsers,
    follow: current.follow - avg.follow,
    fansclubJoin: current.fansclubJoin - avg.fansclubJoin,
    fansclubUpgrade: current.fansclubUpgrade - avg.fansclubUpgrade,
    prank: current.prank - avg.prank,
    prankByRule: {},
    peakOnline: current.peakOnline - avg.peakOnline,
  }
  return { avg, deltas }
}
