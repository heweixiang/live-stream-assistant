/**
 * 弹幕核心子进程：应用启动时自动拉起 core/server.py（ws://127.0.0.1:8765）
 * 退出时若由本进程拉起则一并关闭
 */
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')
const os = require('os')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8765

/** @type {import('child_process').ChildProcess | null} */
let child = null
let ownedByUs = false
/** @type {Promise<{ ok: boolean, error?: string, url?: string, root?: string, python?: string, reused?: boolean }> | null} */
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

function safeDataRoot() {
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron')
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('documents'), '直播助手')
    }
  } catch {
    // ignore
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

/** 工程根：至少要有 core/server.py */
function isCoreRoot(root) {
  if (!root || !dirOk(root)) return false
  return fileOk(path.join(root, 'core', 'server.py'))
}

function readRememberedRoot() {
  const dataRoot = safeDataRoot()
  for (const name of ['meloWorkspace.json', 'settings.json']) {
    const j = readJsonFile(path.join(dataRoot, name), null)
    const root = j?.meloRoot || j?.coreRoot
    if (root && isCoreRoot(root)) return path.resolve(String(root))
  }
  return null
}

function resolveCoreRoot() {
  const candidates = [
    process.env.LIVE_ASSISTANT_ROOT,
    readRememberedRoot(),
    // 开发：app/electron → 仓库根
    path.resolve(__dirname, '../..'),
    path.resolve(path.dirname(process.execPath), '直播助手'),
    path.resolve(path.dirname(process.execPath), '..'),
    path.resolve(path.dirname(process.execPath), '../直播助手'),
    path.join(safeDataRoot(), 'runtime'),
  ].filter(Boolean)

  for (const c of candidates) {
    try {
      const abs = path.resolve(String(c))
      if (isCoreRoot(abs)) return abs
    } catch {
      // ignore
    }
  }
  return null
}

/** 探测该 python 是否能 import websockets */
function pythonHasWebsockets(py) {
  try {
    execFileSync(py, ['-c', 'import websockets'], {
      windowsHide: true,
      timeout: 8000,
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

function resolvePython(root) {
  const candidates = []
  if (root) {
    candidates.push(path.join(root, '.venv', 'Scripts', 'python.exe'))
    candidates.push(path.join(root, '.venv', 'bin', 'python'))
  }
  // 系统 Python（PATH）
  candidates.push('python')
  candidates.push('python3')
  // Windows 启动器
  if (process.platform === 'win32') {
    candidates.push('py')
    const local = process.env.LOCALAPPDATA
    if (local) {
      try {
        const pyDir = path.join(local, 'Programs', 'Python')
        if (dirOk(pyDir)) {
          for (const name of fs.readdirSync(pyDir)) {
            const exe = path.join(pyDir, name, 'python.exe')
            if (fileOk(exe)) candidates.push(exe)
          }
        }
      } catch {
        // ignore
      }
    }
  }

  for (const c of candidates) {
    try {
      // py 启动器需要 -3
      if (c === 'py') {
        try {
          execFileSync('py', ['-3', '-c', 'import websockets'], {
            windowsHide: true,
            timeout: 8000,
            stdio: ['ignore', 'ignore', 'ignore'],
          })
          return { cmd: 'py', argsPrefix: ['-3'] }
        } catch {
          continue
        }
      }
      if (c.includes(path.sep) || c.includes('/')) {
        if (!fileOk(c)) continue
      }
      if (pythonHasWebsockets(c)) return { cmd: c, argsPrefix: [] }
    } catch {
      // ignore
    }
  }
  return null
}

function probePort(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      try {
        sock.destroy()
      } catch {
        // ignore
      }
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.on('connect', () => finish(true))
    sock.on('timeout', () => finish(false))
    sock.on('error', () => finish(false))
  })
}

async function waitUntilListening(timeoutMs = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (ownedByUs && child && child.exitCode != null) {
      return {
        ok: false,
        error: `弹幕核心进程已退出（code=${child.exitCode}）`,
      }
    }
    if (await probePort(DEFAULT_HOST, DEFAULT_PORT)) {
      return { ok: true }
    }
    await sleep(400)
  }
  return { ok: false, error: '弹幕核心启动超时（8765 未监听）' }
}

function spawnCore(root, py) {
  const script = path.join(root, 'core', 'server.py')
  if (!fileOk(script)) throw new Error(`未找到 ${script}`)
  if (!py) throw new Error('未找到可用的 Python（需已安装 websockets）')

  const logDir = path.join(safeDataRoot(), 'logs')
  fs.mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'live-core.log')
  const logFd = fs.openSync(logPath, 'a')

  const args = [...(py.argsPrefix || []), script, '--mode', 'idle']
  const proc = spawn(py.cmd, args, {
    cwd: path.join(root, 'core'),
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
    windowsHide: true,
    stdio: ['ignore', logFd, logFd],
  })
  proc.on('exit', () => {
    try {
      fs.closeSync(logFd)
    } catch {
      // ignore
    }
  })
  return proc
}

/**
 * 确保弹幕核心在跑
 * @param {{ waitReady?: boolean }} [opts]
 */
function ensureLiveCore(opts = {}) {
  const waitReady = opts.waitReady !== false
  if (ensurePromise) return ensurePromise

  ensurePromise = (async () => {
    const url = `ws://${DEFAULT_HOST}:${DEFAULT_PORT}`
    if (await probePort(DEFAULT_HOST, DEFAULT_PORT)) {
      return { ok: true, url, reused: true }
    }

    const root = resolveCoreRoot()
    if (!root) {
      return {
        ok: false,
        error:
          '未找到弹幕核心工程（需要含 core/server.py）。可设置 LIVE_ASSISTANT_ROOT，或把工程放在便携版旁。',
      }
    }

    const py = resolvePython(root)
    if (!py) {
      return {
        ok: false,
        error:
          '未找到可用 Python，或未安装依赖。请在系统安装 Python 后执行：pip install -r core/requirements.txt',
        root,
      }
    }

    try {
      child = spawnCore(root, py)
      ownedByUs = true
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), root }
    }

    if (!waitReady) {
      return { ok: true, url, root, python: py.cmd, starting: true }
    }
    const w = await waitUntilListening()
    return { ...w, url, root, python: py.cmd }
  })().finally(() => {
    ensurePromise = null
  })

  return ensurePromise
}

function stopLiveCore() {
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

function getLiveCoreStatus() {
  return {
    owned: ownedByUs,
    pid: child?.pid || null,
    root: resolveCoreRoot(),
    url: `ws://${DEFAULT_HOST}:${DEFAULT_PORT}`,
  }
}

module.exports = {
  ensureLiveCore,
  stopLiveCore,
  getLiveCoreStatus,
  resolveCoreRoot,
}
