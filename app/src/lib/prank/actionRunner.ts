import type { EffectMode, PrankRule, RuleAction } from './model'
import { actionSummary } from './model'

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

export type DryToastFn = (msg: string, meta?: { durationMs?: number }) => void

function toastDurationMs(action: RuleAction) {
  const sec = Number(action.toastCloseSec)
  const s = Number.isFinite(sec) && sec > 0 ? sec : 3
  return Math.round(Math.min(60, Math.max(0.5, s)) * 1000)
}

async function playSound(path: string) {
  const p = (path || '').trim()
  // 未选音效文件：跳过，不阻断后续动作（键鼠/提示等）
  if (!p) return
  const api = window.liveAssistant
  let url = p
  if (!p.startsWith('data:') && !p.startsWith('http') && !p.startsWith('blob:')) {
    if (!api?.mediaAsDataUrl) return
    url = await api.mediaAsDataUrl(p)
  }
  if (api?.playAudioDataUrl && (url.startsWith('data:audio/wav') || url.startsWith('data:audio/mpeg') || url.startsWith('data:audio/mp3'))) {
    const res = await api.playAudioDataUrl(url, 1)
    if (res?.ok !== false) return
  }
  const audio = new Audio(url)
  await audio.play()
}

/** 浏览器/Electron：按系统设置朗读（MeloTTS / 本机） */
async function speakTts(action: RuleAction) {
  const { speakFromAction } = await import('../tts/speak')
  await speakFromAction(action)
}

async function runOne(action: RuleAction, opts?: { dryToast?: DryToastFn }) {
  const start = Math.max(0, action.delayStartSec || 0) * 1000
  if (start) await sleep(start)

  const api = window.liveAssistant
  // IPC 不能可靠传递 Vue Proxy，先打成纯对象
  const plain = JSON.parse(JSON.stringify(action)) as RuleAction

  switch (plain.category) {
    case 'sound': {
      const mode =
        plain.soundMode || (plain.ttsText && !plain.mediaPath ? 'tts' : 'file')
      if (mode === 'tts') await speakTts(plain)
      else await playSound(plain.mediaPath || '')
      break
    }
    case 'other': {
      const op = plain.otherOp || 'toast'
      if (op === 'toast') {
        opts?.dryToast?.(plain.message || actionSummary(plain), {
          durationMs: toastDurationMs(plain),
        })
        break
      }
      if (op === 'notify') {
        if (api?.notify) await api.notify('整蛊触发', plain.message || '')
        else opts?.dryToast?.(plain.message || '通知', { durationMs: toastDurationMs(plain) })
        break
      }
      if (!api?.runAction) {
        opts?.dryToast?.(`${actionSummary(plain)}（需桌面客户端）`)
        break
      }
      const res = await api.runAction(plain)
      if (!res?.ok && res?.kind !== 'stub') throw new Error(res?.error || '动作执行失败')
      if (res.message) opts?.dryToast?.(res.message)
      break
    }
    case 'keyboard':
    case 'mouse': {
      if (!api?.runAction) {
        opts?.dryToast?.(`${actionSummary(plain)}（需桌面客户端）`)
        break
      }
      const res = await api.runAction(plain)
      if (!res?.ok) throw new Error(res?.error || '动作执行失败')
      if (res.message) opts?.dryToast?.(res.message)
      break
    }
    case 'video':
    case 'desktop_video':
    case 'key_replay':
    case 'obs_source':
    case 'obs_filter':
    case 'hardware':
      opts?.dryToast?.(`${actionSummary(plain)}（尚未接入，已跳过）`)
      break
    default:
      break
  }

  const end = Math.max(0, plain.delayEndSec || 0) * 1000
  if (end) await sleep(end)
}

function pickActions(rule: PrankRule): RuleAction[] {
  // 仅执行勾选的效果；缺省视为开启
  const list = (rule.actions || []).filter((a) => a.enabled !== false)
  if (!list.length) return []
  if (rule.effectMode === 'random') {
    const i = Math.floor(Math.random() * list.length)
    return [list[i]]
  }
  return list
}

async function runList(actions: RuleAction[], mode: EffectMode, opts?: { dryToast?: DryToastFn }) {
  if (mode === 'parallel') {
    await Promise.all(actions.map((a) => runOne(a, opts)))
    return
  }
  for (const a of actions) {
    await runOne(a, opts)
  }
}

/** 执行一条规则的全部效果（含连触） */
export async function runRuleEffects(
  rule: PrankRule,
  times = 1,
  intervalSec = 1,
  opts?: { dryToast?: DryToastFn },
) {
  const actions = pickActions(rule)
  if (!actions.length) {
    opts?.dryToast?.(`${rule.name}：未配置效果`)
    return
  }
  const n = Math.max(1, times)
  for (let i = 0; i < n; i++) {
    await runList(actions, rule.effectMode, opts)
    if (i < n - 1) {
      await sleep(Math.max(0, intervalSec) * 1000)
    }
  }
}

/** 仅测试单条行为 */
export async function testAction(action: RuleAction, opts?: { dryToast?: DryToastFn }) {
  await runOne(action, opts)
}
