import type { EffectMode, PrankRule, RuleAction } from './model'
import { actionSummary, resolveRepeatCount } from './model'

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

export type DryToastFn = (msg: string, meta?: { durationMs?: number }) => void

/** 抓鸭子等：先随机次数，再掷概率，结果供 TTS / 单击共用 */
export type SharedRoll = {
  count: number
  hit: boolean
  resultText: string
}

function toastDurationMs(action: RuleAction) {
  const sec = Number(action.toastCloseSec)
  const s = Number.isFinite(sec) && sec > 0 ? sec : 3
  return Math.round(Math.min(60, Math.max(0.5, s)) * 1000)
}

function rollProbability(probPercent?: number): boolean {
  let p = Number(probPercent)
  if (!Number.isFinite(p)) p = 100
  p = Math.max(0, Math.min(100, p))
  if (p >= 100) return true
  if (p <= 0) return false
  return Math.random() * 100 < p
}

function isMouseClick(a: RuleAction) {
  const op = a.mouseOp || 'click_left'
  return op === 'click_left' || op === 'click_right' || op === 'click_middle'
}

function fillTokens(text: string | undefined, roll: SharedRoll): string | undefined {
  if (text == null) return text
  return text
    .replace(/【次数】/g, String(roll.count))
    .replace(/【数量】/g, String(roll.count))
    .replace(/【结果】/g, roll.resultText)
}

async function playSound(path: string) {
  const p = (path || '').trim()
  if (!p) return
  const api = window.liveAssistant
  let url = p
  if (!p.startsWith('data:') && !p.startsWith('http') && !p.startsWith('blob:')) {
    if (!api?.mediaAsDataUrl) return
    url = await api.mediaAsDataUrl(p)
  }
  if (
    api?.playAudioDataUrl &&
    (url.startsWith('data:audio/wav') ||
      url.startsWith('data:audio/mpeg') ||
      url.startsWith('data:audio/mp3'))
  ) {
    const res = await api.playAudioDataUrl(url, 1)
    if (res?.ok !== false) return
  }
  const audio = new Audio(url)
  await audio.play()
}

async function speakTts(action: RuleAction) {
  const { speakFromAction } = await import('../tts/speak')
  await speakFromAction(action)
}

/** 从效果列表里找带随机次数/概率的键鼠动作，抽一次共享结果 */
export function makeSharedRoll(actions: RuleAction[]): SharedRoll | null {
  const src =
    actions.find((a) => a.category === 'mouse' && isMouseClick(a)) ||
    actions.find((a) => a.category === 'keyboard') ||
    null
  if (!src) return null

  if (src.category === 'mouse') {
    const count = resolveRepeatCount(
      src.mouseClickMode,
      src.mouseClickCount,
      src.mouseClickMin,
      src.mouseClickMax,
    )
    const hit = rollProbability(src.mouseClickProbability)
    return { count, hit, resultText: hit ? '抓到了' : '没抓到' }
  }

  const count = resolveRepeatCount(
    src.keyRepeatMode,
    src.keyRepeat,
    src.keyRepeatMin,
    src.keyRepeatMax,
  )
  const hit = rollProbability(src.keyRepeatProbability)
  return { count, hit, resultText: hit ? '抓到了' : '没抓到' }
}

/**
 * 把共享掷骰结果注入动作；返回 null 表示本条跳过（如没抓到则不点鼠标）
 */
export function applySharedRoll(action: RuleAction, roll: SharedRoll): RuleAction | null {
  const next: RuleAction = JSON.parse(JSON.stringify(action)) as RuleAction
  next.ttsText = fillTokens(next.ttsText, roll)
  next.message = fillTokens(next.message, roll)

  if (next.category === 'mouse' && isMouseClick(next)) {
    if (!roll.hit) return null
    next.mouseClickMode = 'fixed'
    next.mouseClickCount = roll.count
    next.mouseClickProbability = 100
  }
  if (next.category === 'keyboard') {
    if (!roll.hit) return null
    next.keyRepeatMode = 'fixed'
    next.keyRepeat = roll.count
    next.keyRepeatProbability = 100
  }
  return next
}

/** @deprecated 礼物次数注入；bind 已改为共享掷骰，保留兼容 */
export function applyTriggerCount(action: RuleAction, triggerCount: number): RuleAction {
  const n = Math.max(1, Math.round(Number(triggerCount)) || 1)
  return (
    applySharedRoll(action, { count: n, hit: true, resultText: '抓到了' }) || action
  )
}

async function runOne(
  action: RuleAction,
  opts?: { dryToast?: DryToastFn; sharedRoll?: SharedRoll },
) {
  const start = Math.max(0, action.delayStartSec || 0) * 1000
  if (start) await sleep(start)

  const api = window.liveAssistant
  let plain = JSON.parse(JSON.stringify(action)) as RuleAction
  let roll = opts?.sharedRoll

  // 单条测试 / 非 bind：键鼠单击自己掷骰，并可朗读动作上的 ttsText
  if (!roll && plain.category === 'mouse' && isMouseClick(plain)) {
    roll = makeSharedRoll([plain]) || undefined
  }
  if (!roll && plain.category === 'keyboard') {
    roll = makeSharedRoll([plain]) || undefined
  }

  if (roll) {
    const applied = applySharedRoll(plain, roll)
    if (!applied) {
      // 没抓到：若本条是键鼠则跳过；若是 TTS 仍要播「没抓到」
      if (plain.category === 'sound' || plain.category === 'other') {
        plain.ttsText = fillTokens(plain.ttsText, roll)
        plain.message = fillTokens(plain.message, roll)
      } else if (plain.category === 'mouse' && (plain.ttsText || '').trim()) {
        // 鼠标动作上顺便写了话术：没抓到也播报
        const speak = JSON.parse(JSON.stringify(plain)) as RuleAction
        speak.category = 'sound'
        speak.soundMode = 'tts'
        speak.ttsText = fillTokens(plain.ttsText, roll)
        await speakTts(speak)
        opts?.dryToast?.(`没抓到（本应 ×${roll.count}）`)
        return
      } else {
        opts?.dryToast?.(`没抓到（本应 ×${roll.count}）`)
        return
      }
    } else {
      plain = applied
    }
  }

  // 鼠标单击动作上附带了 TTS 文案：先喊再点（抓鸭子一键配置）
  if (
    plain.category === 'mouse' &&
    isMouseClick(plain) &&
    (plain.ttsText || '').trim()
  ) {
    const speak = JSON.parse(JSON.stringify(plain)) as RuleAction
    speak.category = 'sound'
    speak.soundMode = 'tts'
    await speakTts(speak)
  }

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
        // 正式触发不弹系统通知；测试玩法有 dryToast 时用应用内提示
        opts?.dryToast?.(plain.message || '通知', { durationMs: toastDurationMs(plain) })
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
  const list = (rule.actions || []).filter((a) => a.enabled !== false)
  if (!list.length) return []
  if (rule.effectMode === 'random') {
    const i = Math.floor(Math.random() * list.length)
    return [list[i]]
  }
  return list
}

async function runList(
  actions: RuleAction[],
  mode: EffectMode,
  opts?: { dryToast?: DryToastFn; sharedRoll?: SharedRoll },
) {
  if (mode === 'parallel') {
    await Promise.all(actions.map((a) => runOne(a, opts)))
    return
  }
  for (const a of actions) {
    await runOne(a, opts)
  }
}

const ruleRunChain = new Map<string, Promise<void>>()

/** 执行一条规则的全部效果（含连触）；同规则排队 */
export async function runRuleEffects(
  rule: PrankRule,
  times = 1,
  intervalSec = 1,
  opts?: { dryToast?: DryToastFn },
) {
  const id = rule.id || rule.name || '_anon_'
  const prev = ruleRunChain.get(id) || Promise.resolve()
  const job = prev
    .catch(() => {
      // 上一段失败不阻断后续排队
    })
    .then(async () => {
      const actions = pickActions(rule)
      if (!actions.length) {
        opts?.dryToast?.(`${rule.name}：未配置效果`)
        return
      }
      const n = Math.max(1, times)

      // bind：只跑一轮；次数/成败由键鼠配置的随机范围+概率掷出（不跟礼物个数）
      if (rule.effectTimesMode === 'bind') {
        const sharedRoll = makeSharedRoll(actions) || undefined
        await runList(actions, rule.effectMode, { ...opts, sharedRoll })
        return
      }

      for (let i = 0; i < n; i++) {
        await runList(actions, rule.effectMode, opts)
        if (i < n - 1) {
          await sleep(Math.max(0, intervalSec) * 1000)
        }
      }
    })
  ruleRunChain.set(id, job)
  try {
    await job
  } finally {
    if (ruleRunChain.get(id) === job) ruleRunChain.delete(id)
  }
}

/** 仅测试单条行为 */
export async function testAction(action: RuleAction, opts?: { dryToast?: DryToastFn }) {
  await runOne(action, opts)
}
