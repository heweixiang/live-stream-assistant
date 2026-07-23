/**
 * 点赞按固定秒数窗口聚合：窗口内累加，整窗结束再逐用户回调（播报/整蛊）
 * 例：设 5 → 每 5 秒把这 5 秒内的点赞按用户合并数量后触发一次
 */
import type { LiveEvent } from '../types'
import { getLikeMergeSec } from './tts/announce'

type Handler = (merged: LiveEvent) => void

let handler: Handler | null = null
const bucket = new Map<string, LiveEvent>()
let windowTimer: ReturnType<typeof setTimeout> | null = null

function likeCountOf(e: LiveEvent) {
  return Math.max(1, Number(e.extra?.count ?? 1) || 1)
}

function mergeLike(prev: LiveEvent, next: LiveEvent): LiveEvent {
  return {
    ...prev,
    extra: {
      ...(prev.extra ?? {}),
      ...(next.extra ?? {}),
      count: likeCountOf(prev) + likeCountOf(next),
      like_total: next.extra?.like_total ?? prev.extra?.like_total,
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
  if (!cb) return
  for (const e of items) {
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
}

/** @deprecated 兼容旧名 */
export function scheduleLikeSettled(event: LiveEvent, onSettle: Handler): boolean {
  if (!handler) setLikeSettleHandler(onSettle)
  return ingestLike(event)
}
