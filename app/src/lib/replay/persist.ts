import type { ReplaySession, ReplaySessionSummary } from './types'

const INDEX_KEY = 'live-assistant.replayIndex'
const SESSION_PREFIX = 'live-assistant.replaySession.'

/** 浏览器兜底：无 Electron 时用 localStorage */
function saveLocal(session: ReplaySession, maxSessions: number) {
  localStorage.setItem(SESSION_PREFIX + session.id, JSON.stringify(session))
  const summary: ReplaySessionSummary = {
    id: session.id,
    liveId: session.liveId,
    title: session.title,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationSec: session.durationSec,
    totals: session.totals,
    eventCount: session.eventCount,
  }
  let index: ReplaySessionSummary[] = []
  try {
    index = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]')
  } catch {
    index = []
  }
  index = [summary, ...index.filter((x) => x.id !== summary.id)].slice(0, maxSessions)
  localStorage.setItem(INDEX_KEY, JSON.stringify(index))
  return { ok: true as const, id: summary.id }
}

export async function persistReplaySession(session: ReplaySession, maxSessions: number) {
  const api = window.liveAssistant
  if (api?.saveReplaySession) {
    return api.saveReplaySession(session, maxSessions)
  }
  return saveLocal(session, maxSessions)
}

export async function listReplaySessions(): Promise<ReplaySessionSummary[]> {
  const api = window.liveAssistant
  if (api?.listReplaySessions) {
    const list = await api.listReplaySessions()
    return Array.isArray(list) ? (list as ReplaySessionSummary[]) : []
  }
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]') as ReplaySessionSummary[]
  } catch {
    return []
  }
}

export async function loadReplaySession(id: string): Promise<ReplaySession | null> {
  const api = window.liveAssistant
  let raw: ReplaySession | null = null
  if (api?.loadReplaySession) {
    const s = await api.loadReplaySession(id)
    raw = (s as ReplaySession | null) || null
  } else {
    try {
      const text = localStorage.getItem(SESSION_PREFIX + id)
      raw = text ? (JSON.parse(text) as ReplaySession) : null
    } catch {
      raw = null
    }
  }
  if (!raw) return null
  const { normalizeReplaySession } = await import('./recorder')
  const fixed = normalizeReplaySession(raw)
  // 洗过重复礼物则回写，列表摘要也会对上
  if (fixed.eventCount !== raw.eventCount || fixed.totals.gift !== raw.totals.gift) {
    try {
      await persistReplaySession(fixed, 40)
    } catch {
      // ignore
    }
  }
  return fixed
}

export async function deleteReplaySession(id: string) {
  const api = window.liveAssistant
  if (api?.deleteReplaySession) {
    return api.deleteReplaySession(id)
  }
  localStorage.removeItem(SESSION_PREFIX + id)
  try {
    const index = JSON.parse(localStorage.getItem(INDEX_KEY) || '[]') as ReplaySessionSummary[]
    localStorage.setItem(INDEX_KEY, JSON.stringify(index.filter((x) => x.id !== id)))
  } catch {
    /* ignore */
  }
  return { ok: true }
}
