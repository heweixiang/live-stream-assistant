import type { FiredAction, LiveEvent, PrankRule } from '../../types'

const ruleCooldownAt = new Map<string, number>()
const userCooldownAt = new Map<string, number>()
/** 用户累计礼物价值（会话内） */
const giftSumByUser = new Map<string, number>()

export function resetRuleEngineState() {
  ruleCooldownAt.clear()
  userCooldownAt.clear()
  giftSumByUser.clear()
}

export interface MatchHit {
  rule: PrankRule
  /** 连触次数（礼物数量等） */
  times: number
  intervalSec: number
  fired: FiredAction
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

    if (!isMatch(event, rule)) continue

    ruleCooldownAt.set(rule.id, now)
    if (userCd > 0) userCooldownAt.set(userKey, now)

    let times = 1
    let intervalSec = rule.trigger.multiIntervalSec || 1
    if (
      rule.trigger.multiByGiftCount &&
      event.type === 'gift' &&
      (event.gift_count || 1) > 1
    ) {
      times = Math.max(1, event.gift_count || 1)
    }

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
      if (event.type !== 'gift') return false
      const name = (t.giftName || '').trim()
      // 下拉选中的是精确礼物名，避免手打「包含」误匹配
      if (name && (event.gift_name || '').trim() !== name) return false
      return (event.gift_count || 1) >= (t.giftCount || 1)
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
      if (event.type !== 'like') return false
      const count = Number(event.extra?.count ?? 1)
      return count >= (t.likeCount || 1)
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
  // 日志左侧已有玩法名，这里只写触发原因，避免「玩法1已触发」重复
  if (event.type === 'gift') {
    return `${event.user} 送出 ${event.gift_name || '礼物'} x${event.gift_count || 1}`
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
