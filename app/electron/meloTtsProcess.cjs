/**
 * 内置 MeloTTS 子进程：应用启动时自动拉起，退出时按需关闭
 * 依赖项目根目录：.venv-melo + core/tts_server.py + models/melo-zh
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const http = require('http')
const os = require('os')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8766
const HEALTH_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}/health`

function safeDataRoot() {
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('documents'), '直播助手')
    }
  } catch {
    // plain node / 未就绪
  }
  return path.join(os.homedir(), 'Documents', '直播助手')
}

function readJsonFile(abs, fallback) {
  try {
    if (!fs.existsSync(abs)) return fallback
    return JSON.parse(fs.readFileSync(abs, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJsonFile(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8')
}

/** @type {import('child_process').ChildProcess | null} */
let child = null
/** 是否由本进程拉起（退出时才杀） */
let ownedByUs = false
/** @type {Promise<{ ok: boolean, ready?: boolean, error?: string, url?: string, root?: string }> | null} */
let ensurePromise = null

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function fileOk(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function dirOk(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** 判断是否为可用的 MeloTTS 工程根 */
function isMeloRoot(root) {
  if (!root || !dirOk(root)) return false
  const script = path.join(root, 'core', 'tts_server.py')
  const pyWin = path.join(root, '.venv-melo', 'Scripts', 'python.exe')
  const pyUnix = path.join(root, '.venv-melo', 'bin', 'python')
  const model = path.join(root, 'models', 'melo-zh', 'checkpoint.pth')
  return fileOk(script) && (fileOk(pyWin) || fileOk(pyUnix)) && fileOk(model)
}

function pythonOf(root) {
  const win = path.join(root, '.venv-melo', 'Scripts', 'python.exe')
  if (fileOk(win)) return win
  const unix = path.join(root, '.venv-melo', 'bin', 'python')
  if (fileOk(unix)) return unix
  return null
}

function rememberRoot(root) {
  try {
    if (!isMeloRoot(root)) return
    const abs = path.resolve(root)
    const dataRoot = safeDataRoot()
    writeJsonFile(path.join(dataRoot, 'meloWorkspace.json'), {
      meloRoot: abs,
      updatedAt: new Date().toISOString(),
    })
    const settingsPath = path.join(dataRoot, 'settings.json')
    const settings = readJsonFile(settingsPath, {})
    settings.meloRoot = abs
    settings.updatedAt = new Date().toISOString()
    writeJsonFile(settingsPath, settings)
  } catch {
    // ignore
  }
}

function readRememberedRoot() {
  const dataRoot = safeDataRoot()
  const fromHint = readJsonFile(path.join(dataRoot, 'meloWorkspace.json'), null)
  if (fromHint?.meloRoot && isMeloRoot(fromHint.meloRoot)) {
    return path.resolve(String(fromHint.meloRoot))
  }
  const fromSettings = readJsonFile(path.join(dataRoot, 'settings.json'), null)
  if (fromSettings?.meloRoot && isMeloRoot(fromSettings.meloRoot)) {
    return path.resolve(String(fromSettings.meloRoot))
  }
  return null
}

/** 候选工程根（开发态 / 便携版旁 / 记忆路径） */
function resolveMeloRoot() {
  const remembered = readRememberedRoot()
  const candidates = [
    process.env.LIVE_ASSISTANT_ROOT,
    remembered,
    // 开发：app/electron → 仓库根
    path.resolve(__dirname, '../..'),
    // 便携 exe 同目录 / 上一级（若把工程拷到旁边）
    path.resolve(path.dirname(process.execPath), '直播助手'),
    path.resolve(path.dirname(process.execPath), '..'),
    path.resolve(path.dirname(process.execPath), '../直播助手'),
    path.join(safeDataRoot(), 'runtime'),
  ].filter(Boolean)

  for (const c of candidates) {
    try {
      const abs = path.resolve(String(c))
      if (isMeloRoot(abs)) {
        rememberRoot(abs)
        return abs
      }
    } catch {
      // ignore
    }
  }
  return null
}

function fetchHealth(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, { timeout: timeoutMs }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (c) => {
        raw += c
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw))
        } catch {
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
  })
}

async function waitUntilReady(timeoutMs = 180000) {
  const t0 = Date.now()
  let lastErr = ''
  while (Date.now() - t0 < timeoutMs) {
    if (ownedByUs && child && child.exitCode != null) {
      return {
        ok: false,
        error: `MeloTTS 进程已退出（code=${child.exitCode}）${lastErr ? '：' + lastErr : ''}`,
      }
    }
    const h = await fetchHealth()
    if (h?.ok && h.ready) return { ok: true, ready: true }
    if (h?.error) lastErr = String(h.error)
    if (h?.ok && !h.ready) {
      await sleep(800)
      continue
    }
    await sleep(500)
  }
  return {
    ok: false,
    error: lastErr || 'MeloTTS 启动超时（模型首次加载可能较慢）',
  }
}

function spawnMelo(root) {
  const py = pythonOf(root)
  const script = path.join(root, 'core', 'tts_server.py')
  if (!py || !fileOk(script)) {
    throw new Error('未找到 MeloTTS 的 Python 环境或脚本')
  }
  const nltk = path.join(root, 'models', 'nltk_data')
  const env = {
    ...process.env,
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_OFFLINE: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  }
  if (dirOk(nltk)) env.NLTK_DATA = nltk

  const logDir = path.join(safeDataRoot(), 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'melo-tts.log')
  const logFd = fs.openSync(logPath, 'a')

  const proc = spawn(
    py,
    [script, '--preload', '--host', DEFAULT_HOST, '--port', String(DEFAULT_PORT)],
    {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
    },
  )
  fs.closeSync(logFd)

  proc.on('exit', (code, signal) => {
    if (child === proc) {
      child = null
      ownedByUs = false
    }
    try {
      fs.appendFileSync(
        logPath,
        `\n[exit] code=${code} signal=${signal} at ${new Date().toISOString()}\n`,
        'utf8',
      )
    } catch {
      // ignore
    }
  })
  return proc
}

/**
 * 确保 MeloTTS 可用：已在跑则复用，否则自动拉起
 * @param {{ waitReady?: boolean }} [opts]
 */
function ensureMeloTts(opts = {}) {
  const waitReady = opts.waitReady !== false
  if (ensurePromise) return ensurePromise

  ensurePromise = (async () => {
    const url = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`
    const existing = await fetchHealth()
    if (existing?.ok && existing.ready) {
      return { ok: true, ready: true, url, reused: true }
    }
    if (existing?.ok && !existing.ready) {
      if (!waitReady) return { ok: true, ready: false, url, loading: true }
      const w = await waitUntilReady()
      return { ...w, url }
    }

    const root = resolveMeloRoot()
    if (!root) {
      return {
        ok: false,
        error:
          '未找到 MeloTTS 运行环境（需要工程根目录含 .venv-melo、core/tts_server.py、models/melo-zh）。可设置环境变量 LIVE_ASSISTANT_ROOT 指向工程根。',
      }
    }

    try {
      child = spawnMelo(root)
      ownedByUs = true
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), root }
    }

    if (!waitReady) {
      return { ok: true, ready: false, url, root, starting: true }
    }
    const w = await waitUntilReady()
    return { ...w, url, root }
  })().finally(() => {
    ensurePromise = null
  })

  return ensurePromise
}

function stopMeloTts() {
  if (!ownedByUs || !child) return
  const proc = child
  child = null
  ownedByUs = false
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } else {
      proc.kill('SIGTERM')
    }
  } catch {
    try {
      proc.kill()
    } catch {
      // ignore
    }
  }
}

function getMeloTtsStatus() {
  return {
    owned: ownedByUs,
    pid: child?.pid || null,
    root: resolveMeloRoot(),
    url: `http://${DEFAULT_HOST}:${DEFAULT_PORT}`,
  }
}

/** 打包同步时写入记忆路径，方便便携版找到工程 */
function writeMeloWorkspaceHint(root) {
  if (!isMeloRoot(root)) return false
  rememberRoot(root)
  return true
}

module.exports = {
  ensureMeloTts,
  stopMeloTts,
  getMeloTtsStatus,
  resolveMeloRoot,
  isMeloRoot,
  writeMeloWorkspaceHint,
  HEALTH_URL,
}
