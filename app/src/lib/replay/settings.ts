import {
  DEFAULT_REPLAY_CONFIG,
  type ReplayConfig,
} from './types'

const KEY = 'live-assistant.replayConfig'

export function loadReplayConfig(): ReplayConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_REPLAY_CONFIG }
    const parsed = JSON.parse(raw) as Partial<ReplayConfig>
    return {
      ...DEFAULT_REPLAY_CONFIG,
      ...parsed,
      maxEventsPerSession: Math.max(
        500,
        Math.min(50000, Number(parsed.maxEventsPerSession) || DEFAULT_REPLAY_CONFIG.maxEventsPerSession),
      ),
      maxSessions: Math.max(5, Math.min(200, Number(parsed.maxSessions) || DEFAULT_REPLAY_CONFIG.maxSessions)),
    }
  } catch {
    return { ...DEFAULT_REPLAY_CONFIG }
  }
}

export function saveReplayConfig(cfg: ReplayConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg))
    void import('../diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}
