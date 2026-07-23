/**
 * 抖音 Web 登录窗：扫码 / 手机号登录后导出 Cookie。
 */
const { BrowserWindow } = require('electron')
const { session } = require('electron')
const path = require('path')

const PARTITION = 'persist:douyin-auth'
const LOGIN_URL = 'https://www.douyin.com/'
const LOGIN_MARKERS = ['sessionid', 'sid_tt', 'uid_tt', 'sid_guard']

/** @type {BrowserWindow | null} */
let loginWin = null
/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null
/** @type {((r: object) => void) | null} */
let pendingResolve = null

function authSession() {
  return session.fromPartition(PARTITION)
}

function isLoggedInCookieMap(map) {
  return LOGIN_MARKERS.some((k) => map.has(k) && String(map.get(k) || '').trim())
}

async function collectCookieString() {
  const ses = authSession()
  const lists = await Promise.all([
    ses.cookies.get({ domain: '.douyin.com' }),
    ses.cookies.get({ domain: 'www.douyin.com' }),
    ses.cookies.get({ domain: 'live.douyin.com' }),
    ses.cookies.get({ url: 'https://www.douyin.com' }),
    ses.cookies.get({ url: 'https://live.douyin.com' }),
  ])
  const map = new Map()
  for (const list of lists) {
    for (const c of list || []) {
      if (c?.name) map.set(c.name, c.value || '')
    }
  }
  const cookie = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  return { cookie, loggedIn: isLoggedInCookieMap(map) }
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function settle(result) {
  const resolve = pendingResolve
  pendingResolve = null
  stopPoll()
  if (resolve) resolve(result)
}

function closeLoginWindow() {
  stopPoll()
  if (loginWin && !loginWin.isDestroyed()) {
    try {
      loginWin.removeAllListeners('closed')
      loginWin.close()
    } catch {
      // ignore
    }
  }
  loginWin = null
}

function startPoll() {
  stopPoll()
  pollTimer = setInterval(async () => {
    try {
      const { cookie, loggedIn } = await collectCookieString()
      if (!loggedIn || !cookie) return
      settle({ ok: true, cookie })
      if (loginWin && !loginWin.isDestroyed()) {
        loginWin.removeAllListeners('closed')
        loginWin.close()
      }
      loginWin = null
    } catch (e) {
      settle({ ok: false, error: e instanceof Error ? e.message : String(e) })
      closeLoginWindow()
    }
  }, 1200)
}

/**
 * @param {import('electron').BrowserWindow | null} parent
 * @param {{ force?: boolean }} [opts]
 */
async function openDouyinLogin(parent, opts = {}) {
  // 已有进行中的登录窗：聚焦并复用同一 Promise
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus()
    return new Promise((resolve) => {
      const prev = pendingResolve
      pendingResolve = (r) => {
        if (prev) prev(r)
        resolve(r)
      }
    })
  }

  if (opts.force) {
    // 强制重新登录：清会话后再开窗
    try {
      await authSession().clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
      })
    } catch {
      // ignore
    }
  } else {
    const cur = await collectCookieString()
    if (cur.loggedIn && cur.cookie) {
      return { ok: true, cookie: cur.cookie, reused: true }
    }
  }

  return new Promise((resolve) => {
    pendingResolve = resolve

    const iconPath = path.join(__dirname, '../build/icon.png')
    loginWin = new BrowserWindow({
      width: 980,
      height: 720,
      minWidth: 720,
      minHeight: 560,
      parent: parent || undefined,
      modal: false,
      title: '抖音登录 — 请扫码或手机号登录，成功后自动关闭',
      icon: iconPath,
      backgroundColor: '#161616',
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    loginWin.setMenuBarVisibility(false)
    loginWin.loadURL(LOGIN_URL).catch(() => {})

    loginWin.on('closed', () => {
      loginWin = null
      if (pendingResolve) {
        settle({ ok: false, canceled: true })
      }
    })

    startPoll()
  })
}

async function clearDouyinAuth() {
  if (pendingResolve) {
    settle({ ok: false, canceled: true })
  }
  closeLoginWindow()
  const ses = authSession()
  await ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
  })
  return true
}

async function peekDouyinCookie() {
  return collectCookieString()
}

module.exports = {
  openDouyinLogin,
  clearDouyinAuth,
  peekDouyinCookie,
  closeLoginWindow,
}
