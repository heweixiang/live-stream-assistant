/**
 * 礼物连击结算：同一用户同一礼物合并，结束后只触发一次副作用（播报/整蛊）
 * - repeat_end === 1 立即结算
 * - 否则短延迟防抖（连击中间包）
 * - 结算后短时内同累计数的重复推送会忽略（抖音常见回放包）
 * - 累计数继续增大则按增量续记，避免整段连击被记两遍
 */
import type { LiveEvent } from '../types'

type Handler = (settled: LiveEvent) => void

const SETTLE_MS = 1400
/** 结算后多久内、累计数未增加的同礼物包视为回放，丢弃 */
const ECHO_IGNORE_MS = 10000
/** 断档多久后不再把更大累计当成「续连击」 */
const COMBO_RESUME_MS = 60000

type Bucket = {
  latest: LiveEvent
  /** 本段连击起始累计（不含） */
  baseCount: number
  timer: ReturnType<typeof setTimeout> | null
}

type SettledMem = {
  total: number
  at: number
}

let handler: Handler | null = null
const buckets = new Map<string, Bucket>()
const lastSettledByKey = new Map<string, SettledMem>()

function giftKey(e: LiveEvent) {
  const user = (e.user || '').trim() || '_anon_'
  const name = (e.gift_name || '').trim() || '_gift_'
  const gid = String(e.extra?.gift_id ?? '')
  return `${user}||${name}||${gid}`
}

function countOf(e: LiveEvent) {
  return Math.max(1, Number(e.gift_count) || 1)
}

function unitValue(e: LiveEvent) {
  const total = Number(e.gift_value) || 0
  const c = countOf(e)
  if (total > 0 && c > 0) return total / c
  return 0
}

function isRepeatEnd(e: LiveEvent) {
  const v = e.extra?.repeat_end
  return v === 1 || v === '1' || v === true
}

function flushKey(key: string) {
  const b = buckets.get(key)
  if (!b) return
  if (b.timer) {
    clearTimeout(b.timer)
    b.timer = null
  }
  buckets.delete(key)

  const total = countOf(b.latest)
  const delta = Math.max(0, total - b.baseCount)
  lastSettledByKey.set(key, { total, at: Date.now() })
  if (delta <= 0) return

  const unit = unitValue(b.latest)
  const settled: LiveEvent = {
    ...b.latest,
    gift_count: delta,
    gift_value: unit > 0 ? Math.round(unit * delta) : b.latest.gift_value,
    extra: {
      ...(b.latest.extra ?? {}),
      gift_delta: delta,
      combo_total: total,
      settled: true,
    },
  }
  const cb = handler
  if (!cb) return
  try {
    cb(settled)
  } catch {
    // ignore
  }
}

export function setGiftSettleHandler(h: Handler | null) {
  handler = h
}

/** 收入礼物；未结算前不触发播报/整蛊 */
export function ingestGift(event: LiveEvent): boolean {
  if (event.type !== 'gift') return false
  const key = giftKey(event)
  const total = countOf(event)
  const prev = buckets.get(key)
  const mem = lastSettledByKey.get(key)
  const now = Date.now()

  if (!prev) {
    let baseCount = 0
    if (mem) {
      const age = now - mem.at
      if (total > mem.total && age <= COMBO_RESUME_MS) {
        // 连击续段：只记增量
        baseCount = mem.total
      } else if (total === mem.total && age <= ECHO_IGNORE_MS) {
        // 抖音重复推送同一累计，忽略
        return true
      } else if (total < mem.total) {
        // 计数器重置，新开一段
        baseCount = 0
      }
      // total === mem.total 且已过回放窗：当作又送了同样数量的新礼物
    }

    const bucket: Bucket = {
      latest: { ...event, extra: { ...(event.extra ?? {}) } },
      baseCount,
      timer: null,
    }
    buckets.set(key, bucket)
    if (isRepeatEnd(event)) {
      flushKey(key)
    } else {
      bucket.timer = setTimeout(() => flushKey(key), SETTLE_MS)
    }
    return true
  }

  // 连击累计变小：视为新的一段
  if (total < countOf(prev.latest)) {
    flushKey(key)
    return ingestGift(event)
  }

  prev.latest = {
    ...event,
    extra: { ...(prev.latest.extra ?? {}), ...(event.extra ?? {}) },
  }
  if (prev.timer) {
    clearTimeout(prev.timer)
    prev.timer = null
  }
  if (isRepeatEnd(event)) {
    flushKey(key)
  } else {
    prev.timer = setTimeout(() => flushKey(key), SETTLE_MS)
  }
  return true
}

export function clearGiftBucket() {
  for (const b of buckets.values()) {
    if (b.timer) clearTimeout(b.timer)
  }
  buckets.clear()
  lastSettledByKey.clear()
}

/** 立刻结算全部未完成连击（断开前可选） */
export function flushGiftBucket() {
  for (const key of [...buckets.keys()]) flushKey(key)
}
