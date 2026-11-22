/**
 * 复盘会话落盘：文档/直播助手/replays/{id}.json + index.json
 */
const fs = require('fs')
const path = require('path')
const { getDataRoot, ensureDataRoot } = require('./dataStore.cjs')

function replaysDir() {
  return path.join(getDataRoot(), 'replays')
}

function indexPath() {
  return path.join(replaysDir(), 'index.json')
}

function ensureReplaysDir() {
  ensureDataRoot()
  fs.mkdirSync(replaysDir(), { recursive: true })
}

function readIndex() {
  try {
    const p = indexPath()
    if (!fs.existsSync(p)) return []
    const data = JSON.parse(fs.readFileSync(p, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function writeIndex(list) {
  ensureReplaysDir()
  fs.writeFileSync(indexPath(), JSON.stringify(list, null, 0), 'utf8')
}

function sessionFile(id) {
  return path.join(replaysDir(), `${String(id).replace(/[^\w.-]/g, '_')}.json`)
}

function saveReplaySession(session, maxSessions = 40) {
  if (!session || !session.id) throw new Error('无效复盘会话')
  ensureReplaysDir()
  const file = sessionFile(session.id)
  fs.writeFileSync(file, JSON.stringify(session), 'utf8')

  const summary = {
    id: session.id,
    liveId: session.liveId || '',
    title: session.title || session.id,
    startedAt: session.startedAt || 0,
    endedAt: session.endedAt || 0,
    durationSec: session.durationSec || 0,
    totals: session.totals || {},
    eventCount: session.eventCount || (session.events || []).length,
  }
  let index = readIndex().filter((x) => x && x.id !== summary.id)
  index.unshift(summary)
  const max = Math.max(5, Number(maxSessions) || 40)
  while (index.length > max) {
    const drop = index.pop()
    if (drop?.id) {
      try {
        fs.unlinkSync(sessionFile(drop.id))
      } catch {
        /* ignore */
      }
    }
  }
  writeIndex(index)
  return { ok: true, id: summary.id, path: file }
}

function listReplaySessions() {
  ensureReplaysDir()
  return readIndex()
}

function loadReplaySession(id) {
  const file = sessionFile(id)
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function deleteReplaySession(id) {
  const file = sessionFile(id)
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file)
  } catch {
    /* ignore */
  }
  writeIndex(readIndex().filter((x) => x.id !== id))
  return { ok: true }
}

module.exports = {
  saveReplaySession,
  listReplaySessions,
  loadReplaySession,
  deleteReplaySession,
  replaysDir,
}
