/**
 * 点赞按固定秒数窗口聚合：窗口内累加，整窗结束再逐用户回调（播报/整蛊）
 * 例：设 5 → 每 5 秒把这 5 秒内的点赞按用户合并数量后触发一次
 *
 * 防抖音重复包：
 * - 窗内同用户同 count + 同 like_total 短时间到达 → 不加数量
 * - 刚结算过的同特征包短时间再来 → 整条忽略
 */
import type { LiveEvent } from '../types'
import { getLikeMergeSec } from './tts/announce'

type Handler = (merged: LiveEvent) => void

const ECHO_IGNORE_MS = 8000

let handler: Handler | null = null
const bucket = new Map<string, LiveEvent>()
let windowTimer: ReturnType<typeof setTimeout> | null = null

/** 上一窗已结算特征，用于丢掉结算后的回放包 */
const lastFlushedByUser = new Map<
  string,
  { count: number; likeTotal: number; at: number }
>()

function likeCountOf(e: LiveEvent) {
  return Math.max(1, Number(e.extra?.count ?? 1) || 1)
}

function likeTotalOf(e: LiveEvent) {
  return Number(e.extra?.like_total ?? 0) || 0
}

function eventTimeMs(e: LiveEvent) {
  const ts = e.ts ?? Date.now()
  return ts > 1e12 ? ts : ts * 1000
}

function mergeLike(prev: LiveEvent, next: LiveEvent): LiveEvent {
  const dt = Math.abs(eventTimeMs(next) - eventTimeMs(prev))
  const sameEcho =
    likeCountOf(prev) === likeCountOf(next) &&
    likeTotalOf(prev) === likeTotalOf(next) &&
    dt <= 2500

  if (sameEcho) {
    // 重复推送：不加数量，只刷新时间戳
    return {
      ...prev,
      ts: next.ts ?? prev.ts,
      extra: {
        ...(prev.extra ?? {}),
        ...(next.extra ?? {}),
        count: likeCountOf(prev),
        like_total: likeTotalOf(next) || likeTotalOf(prev),
      },
    }
  }

  return {
    ...prev,
    extra: {
      ...(prev.extra ?? {}),
      ...(next.extra ?? {}),
      count: likeCountOf(prev) + likeCountOf(next),
      like_total: likeTotalOf(next) || likeTotalOf(prev),
    },
    ts: next.ts ?? prev.ts,
  }
}

export function setLikeSettleHandler(h: Handler | null) {
  handler = h
}

function flush() {
  windowTimer = null
  if (!bucket.size) return
  const items = [...bucket.values()]
  bucket.clear()
  const cb = handler
  const now = Date.now()
  if (!cb) return
  for (const e of items) {
    const user = (e.user || '').trim() || '_anon_'
    lastFlushedByUser.set(user, {
      count: likeCountOf(e),
      likeTotal: likeTotalOf(e),
      at: now,
    })
    try {
      cb(e)
    } catch {
      // ignore
    }
  }
}

/** 收入一条点赞；窗口未开则开启「聚合秒数」定时器 */
export function ingestLike(event: LiveEvent): boolean {
  if (event.type !== 'like') return false
  const user = (event.user || '').trim() || '_anon_'
  const count = likeCountOf(event)
  const likeTotal = likeTotalOf(event)
  const mem = lastFlushedByUser.get(user)
  if (
    mem &&
    Date.now() - mem.at <= ECHO_IGNORE_MS &&
    mem.count === count &&
    mem.likeTotal === likeTotal
  ) {
    // 结算后回放包
    return true
  }

  const prev = bucket.get(user)
  bucket.set(user, prev ? mergeLike(prev, event) : { ...event, extra: { ...(event.extra ?? {}) } })

  if (!windowTimer) {
    const ms = Math.round(getLikeMergeSec() * 1000)
    windowTimer = setTimeout(flush, ms)
  }
  return true
}

/** 立刻清空未播报的点赞桶（停止播报时用） */
export function clearLikeBucket() {
  if (windowTimer) {
    clearTimeout(windowTimer)
    windowTimer = null
  }
  bucket.clear()
  lastFlushedByUser.clear()
}

/** @deprecated 兼容旧名 */
export function scheduleLikeSettled(event: LiveEvent, onSettle: Handler): boolean {
  if (!handler) setLikeSettleHandler(onSettle)
  return ingestLike(event)
}
