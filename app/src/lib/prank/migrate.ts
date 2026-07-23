import type { PrankRule, RuleAction, RuleTrigger } from './model'
import { createEmptyAction } from './model'
import { defaultRules } from './defaultRules'

export { defaultRules }

/** 把旧版规则结构迁移到新模型 */
export function migrateRules(raw: unknown): PrankRule[] | null {
  if (!Array.isArray(raw) || !raw.length) return null

  const first = raw[0] as Record<string, unknown>
  if (Array.isArray(first.actions)) {
    return raw as PrankRule[]
  }

  return raw.map((item, i) => {
    const r = item as {
      id?: string
      name?: string
      enabled?: boolean
      cooldownSec?: number
      trigger?: { type?: string; keywords?: string[]; minValue?: number }
      action?: { type?: string; message?: string; sound?: string }
    }
    const kindMap: Record<string, RuleTrigger['kind']> = {
      keyword: 'chat',
      gift_value: 'gift_value',
      enter: 'enter',
    }
    const trigger: RuleTrigger = {
      kind: kindMap[r.trigger?.type || ''] || 'chat',
      keywords: r.trigger?.keywords || [],
      minValue: r.trigger?.minValue ?? 1,
      giftCount: 1,
      multiByGiftCount: false,
      multiIntervalSec: 1,
      userCooldownSec: 0,
    }
    const act: RuleAction = {
      ...createEmptyAction(r.action?.sound ? 'sound' : 'other'),
      otherOp: 'toast',
      message: r.action?.message || r.name || '触发',
      mediaPath: r.action?.sound || '',
    }
    return {
      id: r.id || `migrated-${i}`,
      name: r.name || `玩法${i + 1}`,
      enabled: r.enabled !== false,
      hotkey: '',
      trigger,
      effectMode: 'sequential' as const,
      actions: [act],
      cooldownSec: r.cooldownSec ?? 3,
    }
  })
}

export function loadDefaultRules(): PrankRule[] {
  return structuredClone(defaultRules)
}
