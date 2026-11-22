/**
 * OBS Browser Source 叠层：本地 HTTP + SSE
 * 默认 http://127.0.0.1:8767/
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const DEFAULT_PORT = 8767

/** @type {import('http').Server | null} */
let server = null
let listenPort = DEFAULT_PORT
/** @type {Set<import('http').ServerResponse>} */
const sseClients = new Set()

/** @type {Record<string, unknown>} */
let latestState = {
  ok: true,
  title: '整蛊统计',
  showTitle: true,
  showTotal: true,
  total: 0,
  panelWidth: 360,
  iconSize: 28,
  fontSize: 16,
  countFontSize: 20,
  gap: 10,
  bgOpacity: 0.45,
  accentColor: '#ff8a3d',
  rows: [],
  updatedAt: 0,
}

function overlayHtmlPath() {
  return path.join(__dirname, 'overlay', 'index.html')
}

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function broadcast() {
  const payload = `data: ${JSON.stringify(latestState)}\n\n`
  for (const res of [...sseClients]) {
    try {
      res.write(payload)
    } catch {
      sseClients.delete(res)
    }
  }
}

function setOverlayState(patch) {
  latestState = {
    ...latestState,
    ...(patch && typeof patch === 'object' ? patch : {}),
    ok: true,
    updatedAt: Date.now(),
  }
  broadcast()
  return latestState
}

function getOverlayState() {
  return latestState
}

/**
 * @param {number} [port]
 * @returns {Promise<{ ok: boolean, url?: string, port?: number, error?: string }>}
 */
function startOverlayServer(port = DEFAULT_PORT) {
  const p = Math.min(65535, Math.max(1024, Number(port) || DEFAULT_PORT))
  if (server) {
    if (listenPort === p) {
      return Promise.resolve({ ok: true, url: `http://127.0.0.1:${p}/`, port: p })
    }
    return stopOverlayServer().then(() => startOverlayServer(p))
  }

  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${p}`)
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        res.end()
        return
      }

      if (url.pathname === '/api/state' && req.method === 'GET') {
        sendJson(res, 200, latestState)
        return
      }

      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        res.write(`data: ${JSON.stringify(latestState)}\n\n`)
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        try {
          const html = fs.readFileSync(overlayHtmlPath(), 'utf8')
          const body = Buffer.from(html, 'utf8')
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': body.length,
            'Cache-Control': 'no-store',
          })
          res.end(body)
        } catch (e) {
          sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
        }
        return
      }

      sendJson(res, 404, { ok: false, error: 'not found' })
    })

    s.on('error', (err) => {
      server = null
      resolve({ ok: false, error: err.message || String(err) })
    })

    s.listen(p, '127.0.0.1', () => {
      server = s
      listenPort = p
      resolve({ ok: true, url: `http://127.0.0.1:${p}/`, port: p })
    })
  })
}

function stopOverlayServer() {
  return new Promise((resolve) => {
    for (const res of sseClients) {
      try {
        res.end()
      } catch {
        // ignore
      }
    }
    sseClients.clear()
    if (!server) {
      resolve({ ok: true })
      return
    }
    const s = server
    server = null
    s.close(() => resolve({ ok: true }))
  })
}

function getOverlayStatus() {
  return {
    running: !!server,
    port: listenPort,
    url: server ? `http://127.0.0.1:${listenPort}/` : '',
    clients: sseClients.size,
  }
}

module.exports = {
  DEFAULT_PORT,
  startOverlayServer,
  stopOverlayServer,
  setOverlayState,
  getOverlayState,
  getOverlayStatus,
}
