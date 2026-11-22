/**
 * Windows 本地动作执行：键鼠、进程、关机等
 * 用 PowerShell + .NET，避免原生模块编译问题
 */
const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

function psEscape(s) {
  return String(s ?? '').replace(/'/g, "''")
}

/**
 * 经 -File 跑脚本。不能用 -Command：其中的 @"..."@ here-string 会被拆坏，
 * 导致按住按键的 Add-Type 根本执行不到。
 */
async function runPs(script, timeoutMs = 15000) {
  // 强制 UTF-8，避免中文窗口标题在 GBK/UTF-8 混用下变成 �
  const wrapped = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
${script}
`
  const file = path.join(
    os.tmpdir(),
    `live-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`,
  )
  // BOM：Windows PowerShell 5 按 UTF-8 读脚本更稳
  fs.writeFileSync(file, `\uFEFF${wrapped}`, 'utf8')
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      {
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      },
    )
    return { stdout: String(stdout || ''), stderr: String(stderr || '') }
  } finally {
    try {
      fs.unlinkSync(file)
    } catch {
      /* ignore */
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 虚拟键码 */
const VK = {
  ctrl: 0x11,
  control: 0x11,
  alt: 0x12,
  shift: 0x10,
  win: 0x5b,
  meta: 0x5b,
  space: 0x20,
  enter: 0x0d,
  return: 0x0d,
  tab: 0x09,
  esc: 0x1b,
  escape: 0x1b,
  backspace: 0x08,
  delete: 0x2e,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  insert: 0x2d,
}

function keyTokenToVk(token) {
  const t = String(token || '').toLowerCase()
  if (!t) return null
  if (VK[t] != null) return VK[t]
  if (/^f([1-9]|1[0-2])$/.test(t)) return 0x70 + (Number(t.slice(1)) - 1)
  if (/^[a-z]$/.test(t)) return t.charCodeAt(0) - 32 // A=0x41
  if (/^[0-9]$/.test(t)) return 0x30 + Number(t)
  return null
}

/**
 * 解析 HotkeyCapture 风格：w / ctrl+w / shift+up
 * @returns {{ mods: number[], vk: number|null, raw: string }}
 */
function parseKeyCombo(raw) {
  const text = String(raw || '').trim()
  if (!text) return { mods: [], vk: null, raw: text }
  const parts = text.toLowerCase().split(/[+\s]+/).filter(Boolean)
  const mods = []
  let main = null
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') mods.push(VK.ctrl)
    else if (p === 'alt') mods.push(VK.alt)
    else if (p === 'shift') mods.push(VK.shift)
    else if (p === 'win' || p === 'meta') mods.push(VK.win)
    else main = p
  }
  return { mods: [...new Set(mods)], vk: keyTokenToVk(main), raw: text }
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

/** 方向键等需要 EXTENDED 标志，游戏/DirectInput 才认 */
function isExtendedVk(vk) {
  return (
    vk === 0x21 || // pageup
    vk === 0x22 || // pagedown
    vk === 0x23 || // end
    vk === 0x24 || // home
    vk === 0x25 || // left
    vk === 0x26 || // up
    vk === 0x27 || // right
    vk === 0x28 || // down
    vk === 0x2d || // insert
    vk === 0x2e || // delete
    vk === 0xa3 || // rctrl
    vk === 0xa5 // ralt
  )
}

/** 真正按住按键 holdSec 秒：keydown 保持按下，并模拟系统连发（记事本会打出 wwwww，游戏里也会一直前进） */
async function holdKeyCombo(rawKeys, holdSec) {
  const { mods, vk } = parseKeyCombo(rawKeys)
  if (vk == null) {
    throw new Error(`无法识别按键「${rawKeys}」，持续按住仅支持单键/组合键如 w、ctrl+w`)
  }
  const holdMs = Math.round(Math.min(120, Math.max(0.05, holdSec)) * 1000)
  const timeoutMs = holdMs + 8000
  const modList = mods.join(', ')
  const extended = isExtendedVk(vk) ? 1 : 0
  const cls = `KeyHold${Date.now().toString(36)}`
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class ${cls} {
  [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint uCode, uint uMapType);
  const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
  const uint KEYEVENTF_KEYUP = 0x0002;
  public static void Hold(byte[] mods, byte key, int holdMs, int extended) {
    uint ext = extended != 0 ? KEYEVENTF_EXTENDEDKEY : 0;
    byte scan = (byte)MapVirtualKey(key, 0);
    for (int i = 0; i < mods.Length; i++) {
      byte ms = (byte)MapVirtualKey(mods[i], 0);
      keybd_event(mods[i], ms, 0, UIntPtr.Zero);
    }
    // 按下并保持（游戏靠「键仍按下」判定）
    keybd_event(key, scan, ext, UIntPtr.Zero);
    int remaining = holdMs;
    // 模拟硬件连发：首击延迟后周期性再发 KEYDOWN，文本框才会出现 wwwww
    int firstDelay = Math.Min(350, remaining);
    if (firstDelay > 0) { Thread.Sleep(firstDelay); remaining -= firstDelay; }
    while (remaining > 0) {
      keybd_event(key, scan, ext, UIntPtr.Zero);
      int step = Math.Min(40, remaining);
      Thread.Sleep(step);
      remaining -= step;
    }
    keybd_event(key, scan, ext | KEYEVENTF_KEYUP, UIntPtr.Zero);
    for (int i = mods.Length - 1; i >= 0; i--) {
      byte ms = (byte)MapVirtualKey(mods[i], 0);
      keybd_event(mods[i], ms, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
  }
}
"@
$mods = [byte[]]@(${modList || ''})
[${cls}]::Hold($mods, ${vk}, ${holdMs}, ${extended})
`
  await runPs(script, timeoutMs)
}

function resolveRepeatCount(mode, fixed, min, max) {
  if (mode === 'random') {
    let a = Math.round(Number(min))
    let b = Math.round(Number(max))
    if (!Number.isFinite(a) || a < 1) a = 1
    if (!Number.isFinite(b) || b < 1) b = a
    if (b < a) {
      const t = a
      a = b
      b = t
    }
    return a + Math.floor(Math.random() * (b - a + 1))
  }
  const n = Math.round(Number(fixed))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** 先定次数后掷概率；未命中则跳过。prob 缺省 100 */
function rollProbability(probPercent) {
  let p = Number(probPercent)
  if (!Number.isFinite(p)) p = 100
  p = Math.max(0, Math.min(100, p))
  if (p >= 100) return true
  if (p <= 0) return false
  return Math.random() * 100 < p
}

async function runKeyboard(action) {
  const raw = String(action.keys || '').trim()
  if (!raw) throw new Error('未设置按键')
  const repeat = resolveRepeatCount(
    action.keyRepeatMode,
    action.keyRepeat,
    action.keyRepeatMin,
    action.keyRepeatMax,
  )
  // 先随机/固定次数，再掷触发概率
  if (!rollProbability(action.keyRepeatProbability)) {
    return { ok: true, message: `未触发(概率) · 本应 ×${repeat}` }
  }
  const interval = Math.max(0, Number(action.keyIntervalSec) || 0) * 1000
  const hold = Math.max(0, Number(action.keyHoldSec) || 0)

  for (let i = 0; i < repeat; i++) {
    if (hold > 0) {
      // 持续时长 = 按住该键多久
      await holdKeyCombo(raw, hold)
    } else {
      const keys = toSendKeys(raw)
      if (!keys) throw new Error('无法识别按键')
      const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${psEscape(keys)}')
`
      await runPs(script)
    }
    if (i < repeat - 1 && interval) await sleep(interval)
  }
  if (hold > 0) return { ok: true, message: `按住 ${raw} ${hold}s ×${repeat}` }
  return { ok: true, message: `${raw} ×${repeat}` }
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

  // 相对当前位置四向移动：游戏多半只认相对位移，不用 SetCursorPos
  if (op === 'move_up' || op === 'move_down' || op === 'move_left' || op === 'move_right') {
    const px = Math.min(50000, Math.max(1, Math.round(Number(action.mouseMovePx) || 200)))
    const ms = Math.min(60000, Math.max(0, Math.round(Number(action.mouseMoveMs) || 500)))
    const dx = op === 'move_left' ? -px : op === 'move_right' ? px : 0
    const dy = op === 'move_up' ? -px : op === 'move_down' ? px : 0
    const timeoutMs = ms + 8000
    const cls = `MouseSlide${Date.now().toString(36)}`
    await runPs(
      `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class ${cls} {
  [DllImport("user32.dll")]
  public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  const int MOUSEEVENTF_MOVE = 0x0001;
  // 相对移动（游戏视角/镜头常用这一路，绝对坐标往往无效）
  public static void Slide(int dx, int dy, int durationMs) {
    if (durationMs <= 0) {
      mouse_event(MOUSEEVENTF_MOVE, dx, dy, 0, 0);
      return;
    }
    int steps = Math.Max(1, durationMs / 8);
    int sleepMs = Math.Max(1, durationMs / steps);
    double accX = 0, accY = 0;
    for (int i = 1; i <= steps; i++) {
      accX += (double)dx / steps;
      accY += (double)dy / steps;
      int sx = (int)Math.Round(accX);
      int sy = (int)Math.Round(accY);
      accX -= sx;
      accY -= sy;
      if (sx != 0 || sy != 0) mouse_event(MOUSEEVENTF_MOVE, sx, sy, 0, 0);
      if (i < steps) Thread.Sleep(sleepMs);
    }
  }
}
"@
[${cls}]::Slide(${dx}, ${dy}, ${ms})
`,
      timeoutMs,
    )
    return { ok: true, message: `${op} 相对 ${px}px / ${ms}ms` }
  }

  // 天旋地转：相对位移螺旋（游戏可读），不再 SetCursorPos
  if (op === 'dizzy') {
    const x2 = Number(action.mouseX2)
    const y2 = Number(action.mouseY2)
    const endX = Number.isFinite(x2) ? x2 : x + 200
    const endY = Number.isFinite(y2) ? y2 : y + 200
    const durationSec = Math.min(30, Math.max(0.3, Number(action.mouseDurationSec) || 2))
    const turns = Math.min(20, Math.max(1, Number(action.mouseSpinTurns) || 4))
    const timeoutMs = Math.ceil(durationSec * 1000) + 8000
    const cls = `DizzyMouse${Date.now().toString(36)}`
    await runPs(
      `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class ${cls} {
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  const int MOUSEEVENTF_MOVE = 0x0001;
  public static void Run(int x1, int y1, int x2, int y2, double durationSec, double turns) {
    POINT cur; GetCursorPos(out cur);
    if (x1 == 0 && y1 == 0) { x1 = cur.X; y1 = cur.Y; }
    int steps = Math.Max(12, (int)(durationSec * 60));
    int sleepMs = Math.Max(8, (int)(durationSec * 1000.0 / steps));
    double dx = x2 - x1, dy = y2 - y1;
    double dist = Math.Sqrt(dx * dx + dy * dy);
    double amp = Math.Max(80.0, dist * 0.45);
    var rnd = new Random();
    int lastX = x1, lastY = y1;
    // 先跳到起点（相对）
    mouse_event(MOUSEEVENTF_MOVE, x1 - cur.X, y1 - cur.Y, 0, 0);
    for (int i = 0; i <= steps; i++) {
      double t = (double)i / steps;
      double cx = x1 + dx * t;
      double cy = y1 + dy * t;
      double envelope = Math.Sin(t * Math.PI);
      double radius = amp * envelope * (0.75 + 0.25 * rnd.NextDouble());
      double angle = t * turns * 2.0 * Math.PI + rnd.NextDouble() * 0.4;
      int px = (int)Math.Round(cx + Math.Cos(angle) * radius);
      int py = (int)Math.Round(cy + Math.Sin(angle) * radius);
      mouse_event(MOUSEEVENTF_MOVE, px - lastX, py - lastY, 0, 0);
      lastX = px; lastY = py;
      if (i < steps) Thread.Sleep(sleepMs);
    }
    mouse_event(MOUSEEVENTF_MOVE, x2 - lastX, y2 - lastY, 0, 0);
  }
}
"@
[${cls}]::Run(${x}, ${y}, ${endX}, ${endY}, ${durationSec}, ${turns})
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
    op === 'click_right' || op === 'hold_right'
      ? { down: 0x0008, up: 0x0010 }
      : op === 'click_middle' || op === 'hold_middle'
        ? { down: 0x0020, up: 0x0040 }
        : { down: 0x0002, up: 0x0004 }

  // 左/中/右键长按：按下 → 等待 → 抬起
  if (op === 'hold_left' || op === 'hold_right' || op === 'hold_middle') {
    const holdSec = Math.min(120, Math.max(0.05, Number(action.mouseHoldSec) || 1))
    const holdMs = Math.round(holdSec * 1000)
    const timeoutMs = holdMs + 5000
    const cls = `MouseHold${Date.now().toString(36)}`
    await runPs(
      `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class ${cls} {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  public static void Hold(int x, int y, int down, int up, int holdMs) {
    if (x != 0 || y != 0) SetCursorPos(x, y);
    mouse_event(down, 0, 0, 0, 0);
    Thread.Sleep(Math.Max(1, holdMs));
    mouse_event(up, 0, 0, 0, 0);
  }
}
"@
[${cls}]::Hold(${x}, ${y}, ${flag.down}, ${flag.up}, ${holdMs})
`,
      timeoutMs,
    )
    return { ok: true, message: `长按 ${holdSec}s` }
  }

  // 仅单击类支持固定/随机次数（同进程内循环，避免重复 Add-Type）
  if (op === 'click_left' || op === 'click_right' || op === 'click_middle') {
    const times = resolveRepeatCount(
      action.mouseClickMode,
      action.mouseClickCount,
      action.mouseClickMin,
      action.mouseClickMax,
    )
    // 先定次数，再掷触发概率
    if (!rollProbability(action.mouseClickProbability)) {
      return { ok: true, message: `未触发(概率) · 本应单击 ×${times}` }
    }
    const intervalMs = Math.max(0, Math.round((Number(action.mouseClickIntervalSec) || 0) * 1000))
    const timeoutMs = times * (intervalMs + 200) + 8000
    const cls = `MouseClickN${Date.now().toString(36)}`
    await runPs(
      `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class ${cls} {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  public static void Clicks(int x, int y, int down, int up, int times, int intervalMs) {
    for (int i = 0; i < times; i++) {
      if (x != 0 || y != 0) SetCursorPos(x, y);
      mouse_event(down, 0, 0, 0, 0);
      mouse_event(up, 0, 0, 0, 0);
      if (i < times - 1 && intervalMs > 0) Thread.Sleep(intervalMs);
    }
  }
}
"@
[${cls}]::Clicks(${x}, ${y}, ${flag.down}, ${flag.up}, ${times}, ${intervalMs})
`,
      timeoutMs,
    )
    return { ok: true, message: `单击 ×${times}` }
  }

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
    case 'keyboard': {
      const r = await runKeyboard(action)
      return r && typeof r === 'object' ? { ok: true, ...r } : { ok: true }
    }
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
