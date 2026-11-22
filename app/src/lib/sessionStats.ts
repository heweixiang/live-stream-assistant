/**
 * 本场会话统计持久化（整蛊触发、弹幕/礼物/进场累计）
 * 仅「清空列表」重置；重连/重启后恢复
 */
import type { FiredAction } from '../types'

const KEY = 'live-assistant.sessionStats'
const MAX_FIRED = 200

export type SessionStats = {
  firedActions: FiredAction[]
  /** 按玩法累计触发次数（OBS/统计用，不受日志裁剪影响） */
  ruleCounts: Record<string, number>
  chatTotal: number
  giftTotal: number
  enterTotal: number
  updatedAt: number
}

export const EMPTY_SESSION_STATS: SessionStats = {
  firedActions: [],
  ruleCounts: {},
  chatTotal: 0,
  giftTotal: 0,
  enterTotal: 0,
  updatedAt: 0,
}

export function loadSessionStats(): SessionStats {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EMPTY_SESSION_STATS, ruleCounts: {}, firedActions: [] }
    const p = JSON.parse(raw) as Partial<SessionStats>
    const fired = Array.isArray(p.firedActions) ? p.firedActions.slice(-MAX_FIRED) : []
    const ruleCounts =
      p.ruleCounts && typeof p.ruleCounts === 'object' && !Array.isArray(p.ruleCounts)
        ? Object.fromEntries(
            Object.entries(p.ruleCounts).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]),
          )
        : {}
    // 旧数据无 ruleCounts 时从日志回填
    if (!Object.keys(ruleCounts).length && fired.length) {
      for (const a of fired) {
        if (!a?.ruleId) continue
        ruleCounts[a.ruleId] = (ruleCounts[a.ruleId] || 0) + 1
      }
    }
    return {
      firedActions: fired,
      ruleCounts,
      chatTotal: Math.max(0, Number(p.chatTotal) || 0),
      giftTotal: Math.max(0, Number(p.giftTotal) || 0),
      enterTotal: Math.max(0, Number(p.enterTotal) || 0),
      updatedAt: Number(p.updatedAt) || 0,
    }
  } catch {
    return { ...EMPTY_SESSION_STATS, ruleCounts: {}, firedActions: [] }
  }
}

export function saveSessionStats(s: SessionStats) {
  try {
    const next: SessionStats = {
      firedActions: (s.firedActions || []).slice(-MAX_FIRED),
      ruleCounts: { ...(s.ruleCounts || {}) },
      chatTotal: Math.max(0, Number(s.chatTotal) || 0),
      giftTotal: Math.max(0, Number(s.giftTotal) || 0),
      enterTotal: Math.max(0, Number(s.enterTotal) || 0),
      updatedAt: Date.now(),
    }
    localStorage.setItem(KEY, JSON.stringify(next))
    void import('./diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

export function clearSessionStats() {
  saveSessionStats({ ...EMPTY_SESSION_STATS, ruleCounts: {}, firedActions: [] })
}

/** 追加整蛊触发；返回新列表与计数表 */
export function appendFired(
  prev: SessionStats,
  items: FiredAction[],
): Pick<SessionStats, 'firedActions' | 'ruleCounts'> {
  const ruleCounts = { ...prev.ruleCounts }
  for (const a of items) {
    if (!a?.ruleId) continue
    // 一次命中记 1 次（与原先 PrankStats 一致，不按 times 翻倍）
    ruleCounts[a.ruleId] = (ruleCounts[a.ruleId] || 0) + 1
  }
  return {
    firedActions: [...prev.firedActions, ...items].slice(-MAX_FIRED),
    ruleCounts,
  }
}
