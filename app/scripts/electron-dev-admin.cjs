/**
 * 开发态以管理员启动 Electron（保留 VITE_DEV_SERVER_URL）
 * 注意：UAC 确认后本脚本需保持存活，否则 concurrently -k 会把 vite 一起杀掉
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const appRoot = path.resolve(__dirname, '..')
const electronBin = require('electron')
const url = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'

const bat = path.join(os.tmpdir(), `live-assistant-dev-admin-${Date.now()}.cmd`)
const body = [
  '@echo off',
  `cd /d "${appRoot.replace(/"/g, '""')}"`,
  `set "VITE_DEV_SERVER_URL=${url.replace(/"/g, '')}"`,
  `"${String(electronBin).replace(/"/g, '""')}" .`,
].join('\r\n')

fs.writeFileSync(bat, body, 'utf8')

const ps = `Start-Process -FilePath '${bat.replace(/'/g, "''")}' -Verb RunAs`
const child = spawn(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
  { stdio: 'inherit', windowsHide: false },
)

child.on('exit', (code) => {
  if (code && code !== 0) {
    console.error('[electron-dev-admin] UAC 可能被取消，exit=', code)
    process.exit(code)
    return
  }
  console.log('[electron-dev-admin] 已请求管理员启动，请在 UAC 点「是」。保持本终端以维持 Vite…')
  // 挂起，避免 concurrently -k 因本进程退出而杀掉 vite
  setInterval(() => {}, 1 << 30)
})
