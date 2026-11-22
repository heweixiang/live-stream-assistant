import type { FiredAction, LiveEvent, PrankRule } from '../../types'
import type { RuleTrigger } from './model'

const ruleCooldownAt = new Map<string, number>()
const userCooldownAt = new Map<string, number>()
/** 用户累计礼物价值（会话内） */
const giftSumByUser = new Map<string, number>()
/** 礼物「达到」模式：用户维度累计进度 ruleId::user::giftKey */
const giftProgressByKey = new Map<string, number>()
/** 点赞「累计达到」：用户维度累计进度 ruleId::user，凑满后扣减重新计 */
const likeProgressByKey = new Map<string, number>()

export function resetRuleEngineState() {
  ruleCooldownAt.clear()
  userCooldownAt.clear()
  giftSumByUser.clear()
  giftProgressByKey.clear()
  likeProgressByKey.clear()
}

export interface MatchHit {
  rule: PrankRule
  /** 连触次数（礼物数量等） */
  times: number
  intervalSec: number
  fired: FiredAction
}

function giftCountModeOf(t: RuleTrigger): 'eq' | 'gte' {
  if (t.giftCountMode === 'eq' || t.giftCountMode === 'gte') return t.giftCountMode
  // 旧数据无 mode：一律按「达到」理解（原 ≥）
  return 'gte'
}

/** 礼物数量：等于 / 达到并重新计数 → 本事件应触发几次 */
function resolveGiftTimes(event: LiveEvent, rule: PrankRule): number {
  const t = rule.trigger
  const need = Math.max(1, Number(t.giftCount) || 1)
  const delta = Math.max(1, Number(event.gift_count) || 1)
  const mode = giftCountModeOf(t)

  if (mode === 'eq') {
    return delta === need ? 1 : 0
  }

  // gte：累计凑满 need 触发一次并扣减（一次送很多可触发多次）
  const giftKey = (t.giftName || '').trim() || '*'
  const key = `${rule.id}::${event.user || '_'}::${giftKey}`
  let progress = (giftProgressByKey.get(key) || 0) + delta
  let times = 0
  while (progress >= need) {
    times += 1
    progress -= need
  }
  giftProgressByKey.set(key, progress)
  return times
}

/** 点赞：按用户累计凑满 likeCount 触发一次并扣减（一次批很多可触发多次） */
function resolveLikeTimes(event: LiveEvent, rule: PrankRule): number {
  const need = Math.max(1, Number(rule.trigger.likeCount) || 1)
  const delta = Math.max(1, Number(event.extra?.count ?? 1) || 1)
  const key = `${rule.id}::${event.user || '_'}`
  let progress = (likeProgressByKey.get(key) || 0) + delta
  let times = 0
  while (progress >= need) {
    times += 1
    progress -= need
  }
  likeProgressByKey.set(key, progress)
  return times
}

/** 匹配规则，返回命中列表（含连触次数） */
export function matchRules(event: LiveEvent, rules: PrankRule[]): MatchHit[] {
  if (event.type === 'status' || event.type === 'room') return []

  const now = Date.now()
  const hits: MatchHit[] = []

  if (event.type === 'gift') {
    const prev = giftSumByUser.get(event.user) || 0
    giftSumByUser.set(event.user, prev + (event.gift_value || 0))
  }

  for (const rule of rules) {
    if (!rule.enabled) continue

    const lastRule = ruleCooldownAt.get(rule.id) ?? 0
    if (now - lastRule < (rule.cooldownSec || 0) * 1000) continue

    const userKey = `${rule.id}::${event.user}`
    const userCd = rule.trigger.userCooldownSec || 0
    if (userCd > 0) {
      const lastUser = userCooldownAt.get(userKey) ?? 0
      if (now - lastUser < userCd * 1000) continue
    }

    // 礼物：先算 times，0 即未命中（进度仍会写入「达到」模式）
    let times = 1
    if (event.type === 'gift' && rule.trigger.kind === 'gift') {
      if (!isGiftNameMatch(event, rule)) continue
      times = resolveGiftTimes(event, rule)
      if (times <= 0) continue
    } else if (event.type === 'like' && rule.trigger.kind === 'like') {
      times = resolveLikeTimes(event, rule)
      if (times <= 0) continue
    } else if (!isMatch(event, rule)) {
      continue
    } else if (event.type === 'chat' && rule.trigger.kind === 'chat') {
      times = resolveChatCatchTimes(event.content || '')
    } else if (
      rule.trigger.multiByGiftCount &&
      event.type === 'gift' &&
      (event.gift_count || 1) > 1
    ) {
      // 其它礼物类触发（价值等）仍兼容旧「按数量连触」
      times = Math.max(1, event.gift_count || 1)
    }

    ruleCooldownAt.set(rule.id, now)
    if (userCd > 0) userCooldownAt.set(userKey, now)

    const intervalSec = rule.trigger.multiIntervalSec || 1

    hits.push({
      rule,
      times,
      intervalSec,
      fired: {
        id: `${rule.id}-${now}`,
        ruleId: rule.id,
        ruleName: rule.name,
        message: buildMessage(event, rule),
        at: now,
      },
    })
  }

  return hits
}

/** 弹幕「抓N只 / 抓几只」→ 次数；其它弹幕默认 1 */
function resolveChatCatchTimes(text: string): number {
  const t = String(text || '')
  const m = t.match(/抓\s*(\d{1,2})\s*只/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n >= 1) return Math.min(99, n)
  }
  if (/抓\s*几\s*只/.test(t)) {
    return 1 + Math.floor(Math.random() * 5) // 1～5
  }
  return 1
}

function isGiftNameMatch(event: LiveEvent, rule: PrankRule): boolean {
  const name = (rule.trigger.giftName || '').trim()
  if (!name) return true
  return (event.gift_name || '').trim() === name
}

function isMatch(event: LiveEvent, rule: PrankRule): boolean {
  const t = rule.trigger
  switch (t.kind) {
    case 'chat': {
      if (event.type !== 'chat') return false
      const text = event.content ?? ''
      const kws = t.keywords ?? []
      if (!kws.length) return false
      return kws.some((kw) => kw && text.includes(kw))
    }
    case 'gift': {
      // 数量逻辑在 resolveGiftTimes
      if (event.type !== 'gift') return false
      return isGiftNameMatch(event, rule)
    }
    case 'gift_value': {
      if (event.type !== 'gift') return false
      return (event.gift_value || 0) >= (t.minValue || 0)
    }
    case 'gift_value_sum': {
      if (event.type !== 'gift') return false
      const sum = giftSumByUser.get(event.user) || 0
      return sum >= (t.minValue || 0)
    }
    case 'like': {
      // 数量逻辑在 resolveLikeTimes（累计达到后触发并重新计数）
      if (event.type !== 'like') return false
      return true
    }
    case 'like_total': {
      if (event.type !== 'like' && event.type !== 'room') return false
      const total = Number(event.extra?.like_total ?? 0)
      return total > 0 && total >= (t.likeTotal || 0)
    }
    case 'follow':
      return event.type === 'follow'
    case 'enter':
      return event.type === 'enter'
    case 'fan_club':
    case 'fan_level':
    case 'share':
    case 'recommend':
      return false
    default:
      return false
  }
}

function buildMessage(event: LiveEvent, _rule: PrankRule): string {
  if (event.type === 'gift') {
    const n = event.extra?.combo_total ?? event.gift_count ?? 1
    return `${event.user} 送出 ${event.gift_name || '礼物'} x${n}`
  }
  if (event.type === 'chat') {
    return `${event.user}：${event.content || ''}`
  }
  if (event.type === 'like') {
    return `${event.user} 点赞 x${Number(event.extra?.count ?? 1) || 1}`
  }
  if (event.type === 'follow') {
    return `${event.user} 关注了主播`
  }
  if (event.type === 'enter') {
    return `${event.user} 来了`
  }
  return event.user || ''
}
