/**
 * Windows 管理员权限检测与提权重启
 */
const { execFile, spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app } = require('electron')

/** @returns {Promise<boolean>} */
function isRunningAsAdmin() {
  if (process.platform !== 'win32') return Promise.resolve(true)
  return new Promise((resolve) => {
    // net session 仅管理员成功；比 whoami /groups 更稳
    execFile(
      'net',
      ['session'],
      { windowsHide: true, timeout: 5000 },
      (err) => resolve(!err),
    )
  })
}

/**
 * 以管理员身份重新启动当前应用（开发态会保留 VITE_DEV_SERVER_URL）
 * @returns {boolean} 是否已发起提权启动
 */
function relaunchAsAdmin() {
  if (process.platform !== 'win32') return false

  const exe = process.execPath
  const args = process.argv.slice(1)
  const wd = process.cwd()
  const bat = path.join(os.tmpdir(), `live-assistant-elevate-${Date.now()}.cmd`)

  const escCmd = (s) => String(s).replace(/"/g, '""')
  const argLine = args.map((a) => `"${escCmd(a)}"`).join(' ')
  const envKeys = ['VITE_DEV_SERVER_URL', 'ELECTRON_RUN_AS_NODE']
  const envLines = envKeys
    .filter((k) => process.env[k])
    .map((k) => `set "${k}=${escCmd(process.env[k])}"`)
    .join('\r\n')

  const body = [
    '@echo off',
    `cd /d "${escCmd(wd)}"`,
    envLines,
    `"${escCmd(exe)}" ${argLine}`,
    // 提权后删掉临时脚本（忽略失败）
    `del /f /q "${escCmd(bat)}" >nul 2>&1`,
  ]
    .filter(Boolean)
    .join('\r\n')

  fs.writeFileSync(bat, body, 'utf8')

  // UAC 弹窗
  const ps = `Start-Process -FilePath '${bat.replace(/'/g, "''")}' -Verb RunAs`
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref()

  // 稍延后退出，避免新进程还没起来
  setTimeout(() => {
    try {
      app.exit(0)
    } catch {
      process.exit(0)
    }
  }, 400)
  return true
}

module.exports = {
  isRunningAsAdmin,
  relaunchAsAdmin,
}
