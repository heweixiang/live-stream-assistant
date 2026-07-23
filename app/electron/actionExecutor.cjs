/**
 * Windows 本地动作执行：键鼠、进程、关机等
 * 用 PowerShell + .NET，避免原生模块编译问题
 */
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

function psEscape(s) {
  return String(s ?? '').replace(/'/g, "''")
}

async function runPs(script) {
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 },
  )
  return { stdout: String(stdout || ''), stderr: String(stderr || '') }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 把用户输入的按键串转成 SendKeys 格式，如 ctrl+a → ^a */
function toSendKeys(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  // 已是 SendKeys 风格
  if (/[\^+%~()]/.test(text) && !text.includes('+') && text.length <= 8) return text

  const parts = text.toLowerCase().split(/[+\s]+/).filter(Boolean)
  const mods = { ctrl: '^', control: '^', alt: '%', shift: '+', win: '^{ESC}' }
  let prefix = ''
  const keys = []
  for (const p of parts) {
    if (mods[p]) prefix += mods[p] === '^{ESC}' ? '' : mods[p]
    else keys.push(p)
  }
  const map = {
    enter: '{ENTER}',
    return: '{ENTER}',
    tab: '{TAB}',
    esc: '{ESC}',
    escape: '{ESC}',
    space: ' ',
    backspace: '{BACKSPACE}',
    delete: '{DELETE}',
    up: '{UP}',
    down: '{DOWN}',
    left: '{LEFT}',
    right: '{RIGHT}',
    f1: '{F1}',
    f2: '{F2}',
    f3: '{F3}',
    f4: '{F4}',
    f5: '{F5}',
    f6: '{F6}',
    f7: '{F7}',
    f8: '{F8}',
    f9: '{F9}',
    f10: '{F10}',
    f11: '{F11}',
    f12: '{F12}',
  }
  const body = keys
    .map((k) => {
      if (map[k]) return map[k]
      if (k.length === 1) return k
      return `{${k.toUpperCase()}}`
    })
    .join('')
  return prefix + body
}

async function runKeyboard(action) {
  const keys = toSendKeys(action.keys)
  if (!keys) throw new Error('未设置按键')
  const repeat = Math.max(1, Number(action.keyRepeat) || 1)
  const interval = Math.max(0, Number(action.keyIntervalSec) || 0) * 1000
  const hold = Math.max(0, Number(action.keyHoldSec) || 0)

  for (let i = 0; i < repeat; i++) {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${psEscape(keys)}')
`
    await runPs(script)
    if (hold) await sleep(hold * 1000)
    if (i < repeat - 1 && interval) await sleep(interval)
  }
}

async function runMouse(action) {
  const op = action.mouseOp || 'click_left'
  const x = Number(action.mouseX) || 0
  const y = Number(action.mouseY) || 0

  if (op === 'move') {
    await runPs(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
`)
    return
  }

  if (op === 'scroll') {
    const delta = Number(action.scrollDelta) || -120
    await runPs(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MouseScroll {
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  public static void Scroll(int d) { mouse_event(0x0800, 0, 0, d, 0); }
}
"@
[MouseScroll]::Scroll(${delta})
`)
    return
  }

  const flag =
    op === 'click_right' ? { down: 0x0008, up: 0x0010 } : op === 'click_middle' ? { down: 0x0020, up: 0x0040 } : { down: 0x0002, up: 0x0004 }

  await runPs(`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class MouseClick {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  public static void Click(int x, int y, int down, int up) {
    if (x != 0 || y != 0) SetCursorPos(x, y);
    mouse_event(down, 0, 0, 0, 0);
    mouse_event(up, 0, 0, 0, 0);
  }
}
"@
[MouseClick]::Click(${x}, ${y}, ${flag.down}, ${flag.up})
`)
}

async function runOther(action) {
  const op = action.otherOp || 'toast'
  switch (op) {
    case 'toast':
    case 'notify':
      return { ok: true, kind: op, message: action.message || '' }
    case 'show_desktop': {
      await runPs(`
$shell = New-Object -ComObject Shell.Application
$shell.ToggleDesktop()
`)
      return { ok: true }
    }
    case 'close_process': {
      const name = String(action.processName || '').trim()
      if (!name) throw new Error('未填写要关闭的程序名')
      const exe = name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`
      await execFileAsync('taskkill', ['/IM', exe, '/F'], { windowsHide: true }).catch((e) => {
        throw new Error(`关闭程序失败：${e.message || e}`)
      })
      return { ok: true, message: `已结束进程 ${exe}` }
    }
    case 'minimize_process': {
      const name = String(action.processName || '').trim()
      if (!name) throw new Error('未填写进程名')
      const bare = name.toLowerCase().endsWith('.exe') ? name.slice(0, -4) : name
      await runPs(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMin {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$procs = Get-Process -Name '${psEscape(bare)}' -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  if ($p.MainWindowHandle -ne [IntPtr]::Zero -and [WinMin]::IsWindowVisible($p.MainWindowHandle)) {
    [WinMin]::ShowWindowAsync($p.MainWindowHandle, 6) | Out-Null
  }
}
`)
      return { ok: true }
    }
    case 'shutdown':
      await execFileAsync('shutdown', ['/s', '/t', '5'], { windowsHide: true })
      return { ok: true, message: '将在 5 秒后关机，可在终端执行 shutdown /a 取消' }
    case 'restart':
      await execFileAsync('shutdown', ['/r', '/t', '5'], { windowsHide: true })
      return { ok: true, message: '将在 5 秒后重启，可执行 shutdown /a 取消' }
    case 'stop_stream':
      return { ok: true, kind: 'stub', message: '自动下播尚未接入推流软件 API' }
    default:
      return { ok: false, kind: 'stub', message: `未知动作 ${op}` }
  }
}

/** Windows SAPI TTS（渲染层 SpeechSynthesis 失败时兜底） */
async function runTts(action) {
  const text = String(action.ttsText || '').trim()
  if (!text) throw new Error('未填写 TTS 文本')
  const rate = Math.min(2, Math.max(0.5, Number(action.ttsRate) || 1))
  // System.Speech Rate: -10~10；映射 0.5→-5, 1→0, 2→5
  const sapiRate = Math.round((rate - 1) * 5)
  const volume = Math.round(Math.min(1, Math.max(0, Number(action.ttsVolume) || 1)) * 100)
  await runPs(`
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = ${sapiRate}
$s.Volume = ${volume}
$s.Speak('${psEscape(text)}')
$s.Dispose()
`)
  return { ok: true }
}

/**
 * @param {object} action
 */
async function executeAction(action) {
  if (!action || !action.category) throw new Error('无效动作')
  switch (action.category) {
    case 'keyboard':
      await runKeyboard(action)
      return { ok: true }
    case 'mouse':
      await runMouse(action)
      return { ok: true }
    case 'sound':
      if (action.soundMode === 'tts' || (!action.mediaPath && action.ttsText)) {
        return runTts(action)
      }
      return { ok: true, kind: 'stub', message: '音效由渲染进程播放' }
    case 'other':
      return runOther(action)
    default:
      return { ok: true, kind: 'stub', message: `主进程不执行类别：${action.category}` }
  }
}

async function listWindowProcesses() {
  const { stdout } = await runPs(`
Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
  Sort-Object ProcessName |
  Select-Object @{N='name';E={$_.ProcessName}}, @{N='title';E={$_.MainWindowTitle}}, @{N='pid';E={$_.Id}} |
  ConvertTo-Json -Compress
`)
  const raw = String(stdout || '').trim()
  if (!raw) return []
  const parsed = JSON.parse(raw)
  const list = Array.isArray(parsed) ? parsed : [parsed]
  const seen = new Set()
  const out = []
  for (const p of list) {
    const name = String(p?.name || '').trim()
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({
      name,
      title: String(p?.title || '').trim(),
      pid: Number(p?.pid) || 0,
    })
  }
  return out.slice(0, 80)
}

module.exports = { executeAction, listWindowProcesses }
