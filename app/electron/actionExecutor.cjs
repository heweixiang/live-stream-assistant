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

async function runPs(script, timeoutMs = 15000) {
  // 强制 UTF-8，避免中文窗口标题在 GBK/UTF-8 混用下变成 �
  const wrapped = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
${script}
`
  const { stdout, stderr } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped],
    {
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    },
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
    return { ok: true }
  }

  // 天旋地转：从 (x,y) 螺旋乱晃移到 (x2,y2)，耗时 duration 秒
  if (op === 'dizzy') {
    const x2 = Number(action.mouseX2)
    const y2 = Number(action.mouseY2)
    const endX = Number.isFinite(x2) ? x2 : x + 200
    const endY = Number.isFinite(y2) ? y2 : y + 200
    const durationSec = Math.min(30, Math.max(0.3, Number(action.mouseDurationSec) || 2))
    const turns = Math.min(20, Math.max(1, Number(action.mouseSpinTurns) || 4))
    const timeoutMs = Math.ceil(durationSec * 1000) + 8000
    await runPs(
      `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class DizzyMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public static void Run(int x1, int y1, int x2, int y2, double durationSec, double turns) {
    if (x1 == 0 && y1 == 0) {
      POINT p; GetCursorPos(out p); x1 = p.X; y1 = p.Y;
    }
    int steps = Math.Max(12, (int)(durationSec * 60));
    int sleepMs = Math.Max(8, (int)(durationSec * 1000.0 / steps));
    double dx = x2 - x1, dy = y2 - y1;
    double dist = Math.Sqrt(dx * dx + dy * dy);
    double amp = Math.Max(80.0, dist * 0.45);
    var rnd = new Random();
    for (int i = 0; i <= steps; i++) {
      double t = (double)i / steps;
      double cx = x1 + dx * t;
      double cy = y1 + dy * t;
      // 半径先放大再收束到终点，带一点随机抖动
      double envelope = Math.Sin(t * Math.PI);
      double radius = amp * envelope * (0.75 + 0.25 * rnd.NextDouble());
      double angle = t * turns * 2.0 * Math.PI + rnd.NextDouble() * 0.4;
      int px = (int)Math.Round(cx + Math.Cos(angle) * radius);
      int py = (int)Math.Round(cy + Math.Sin(angle) * radius);
      SetCursorPos(px, py);
      if (i < steps) Thread.Sleep(sleepMs);
    }
    SetCursorPos(x2, y2);
  }
}
"@
[DizzyMouse]::Run(${x}, ${y}, ${endX}, ${endY}, ${durationSec}, ${turns})
`,
      timeoutMs,
    )
    return { ok: true, message: `天旋地转 ${durationSec}s` }
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
    return { ok: true }
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
  return { ok: true }
}

async function runOther(action) {
  const op = action.otherOp || 'toast'
  switch (op) {
    case 'toast':
    case 'notify':
      return { ok: true, kind: op, message: action.message || '' }
    case 'show_desktop': {
      // ToggleDesktop 在部分环境无效；改用 MinimizeAll + Win+D 兜底
      await runPs(`
$ErrorActionPreference = 'Continue'
try {
  $shell = New-Object -ComObject Shell.Application
  $shell.MinimizeAll()
} catch {}
Start-Sleep -Milliseconds 80
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinDesktop {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  const byte VK_LWIN = 0x5B;
  const byte VK_D = 0x44;
  const uint KEYEVENTF_KEYUP = 0x0002;
  public static void ShowDesktop() {
    keybd_event(VK_LWIN, 0, 0, UIntPtr.Zero);
    keybd_event(VK_D, 0, 0, UIntPtr.Zero);
    keybd_event(VK_D, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(VK_LWIN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
}
"@
[WinDesktop]::ShowDesktop()
`)
      return { ok: true, message: '已返回桌面' }
    }
    case 'close_process': {
      const name = String(action.processName || '').trim()
      if (!name) throw new Error('未填写要关闭的程序名')
      // 支持填「notepad」「notepad.exe」「C:\...\notepad.exe」
      let base = name.replace(/^.*[\\/]/, '').trim()
      if (!base) throw new Error('进程名无效')
      const bare = base.toLowerCase().endsWith('.exe') ? base.slice(0, -4) : base
      const exe = `${bare}.exe`
      try {
        const { stdout } = await runPs(`
$ErrorActionPreference = 'Stop'
$bare = '${psEscape(bare)}'
$exe = '${psEscape(exe)}'
$found = @(Get-Process -Name $bare -ErrorAction SilentlyContinue)
if ($found.Count -eq 0) {
  throw "未找到正在运行的进程：$exe。请点「刷新」从列表选择正确进程名（不要用窗口标题）。"
}
$killed = New-Object System.Collections.Generic.List[string]
foreach ($p in $found) {
  try {
    Stop-Process -Id $p.Id -Force -ErrorAction Stop
    $killed.Add("$($p.ProcessName)#$($p.Id)")
  } catch {}
}
Start-Sleep -Milliseconds 150
$left = @(Get-Process -Name $bare -ErrorAction SilentlyContinue)
if ($left.Count -gt 0) {
  $null = Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/IM', $exe, '/F', '/T') -Wait -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 200
  $left = @(Get-Process -Name $bare -ErrorAction SilentlyContinue)
}
if ($left.Count -gt 0) {
  $ids = ($left | ForEach-Object { $_.Id }) -join ','
  throw "未能结束进程 $exe（仍在运行 PID: $ids）。可能需要管理员权限。"
}
if ($killed.Count -gt 0) { "已结束：$($killed -join ', ')" } else { "已结束进程 $exe" }
`)
        const msg = (stdout || '').trim() || `已结束进程 ${exe}`
        return { ok: true, message: msg }
      } catch (e) {
        const err = /** @type {Error & { stderr?: string, stdout?: string }} */ (e)
        const raw = [err.stderr, err.stdout, err.message].filter(Boolean).join('\n')
        const m = raw.match(/未找到正在运行的进程[^\r\n]+|未能结束进程[^\r\n]+/)
        throw new Error(m ? m[0].trim() : `关闭程序失败：${(err.stderr || err.message || raw).toString().trim()}`)
      }
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
      return runMouse(action)
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
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  // 写 UTF-8 临时文件再读，避免管道编码再次踩坑
  const tmp = path.join(os.tmpdir(), `live-assistant-procs-${process.pid}-${Date.now()}.json`)
  const tmpPs = tmp.replace(/'/g, "''")
  try {
    await runPs(`
$list = @(Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
  Sort-Object ProcessName |
  Select-Object @{N='name';E={$_.ProcessName}}, @{N='title';E={$_.MainWindowTitle}}, @{N='pid';E={$_.Id}})
if ($list.Count -eq 0) {
  '[]' | Out-File -FilePath '${tmpPs}' -Encoding utf8
} else {
  $list | ConvertTo-Json -Compress -Depth 4 | Out-File -FilePath '${tmpPs}' -Encoding utf8
}
`)
    if (!fs.existsSync(tmp)) return []
    const raw = fs.readFileSync(tmp, 'utf8').replace(/^\uFEFF/, '').trim()
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
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      // ignore
    }
  }
}

module.exports = { executeAction, listWindowProcesses }
