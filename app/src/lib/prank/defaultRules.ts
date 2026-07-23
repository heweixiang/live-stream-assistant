import type { PrankRule } from './model'
import { createEmptyAction, newRuleId } from './model'

/** 内置示例玩法 */
export const defaultRules: PrankRule[] = [
  {
    id: 'demo-gun',
    name: '开枪',
    enabled: true,
    hotkey: '',
    trigger: {
      kind: 'gift',
      giftName: '人气票',
      giftCount: 1,
      multiByGiftCount: true,
      multiIntervalSec: 1,
      userCooldownSec: 0,
    },
    effectMode: 'sequential',
    actions: [
      {
        ...createEmptyAction('sound'),
        mediaPath: '',
        message: '开枪音效',
      },
      {
        ...createEmptyAction('mouse'),
        mouseOp: 'click_left',
      },
    ],
    cooldownSec: 0,
  },
  {
    id: 'demo-keyword',
    name: '关键词·整蛊',
    enabled: true,
    hotkey: '',
    trigger: {
      kind: 'chat',
      keywords: ['整蛊', '惩罚'],
      userCooldownSec: 8,
    },
    effectMode: 'sequential',
    actions: [
      {
        ...createEmptyAction('other'),
        otherOp: 'toast',
        message: '有人喊整蛊！准备上惩罚环节',
      },
      {
        ...createEmptyAction('other'),
        otherOp: 'notify',
        message: '整蛊关键词触发',
      },
    ],
    cooldownSec: 8,
  },
  {
    id: 'demo-big-gift',
    name: '大礼物冲击',
    enabled: true,
    hotkey: '',
    trigger: {
      kind: 'gift_value',
      minValue: 1000,
      userCooldownSec: 5,
    },
    effectMode: 'parallel',
    actions: [
      {
        ...createEmptyAction('other'),
        otherOp: 'toast',
        message: '大礼物！全场震动',
      },
    ],
    cooldownSec: 5,
  },
  {
    id: newRuleId(),
    name: '进场欢迎',
    enabled: false,
    hotkey: '',
    trigger: {
      kind: 'enter',
      userCooldownSec: 3,
    },
    effectMode: 'sequential',
    actions: [
      {
        ...createEmptyAction('other'),
        otherOp: 'toast',
        message: '欢迎新朋友进场',
      },
    ],
    cooldownSec: 3,
  },
]
