export type EventType = 'chat' | 'gift' | 'enter' | 'like' | 'follow' | 'notice' | 'status' | 'room'

export type ContentPart = { type: 'text' | 'emoji' | 'image'; value: string }

export interface LiveEvent {
  type: EventType
  user: string
  content?: string
  gift_name?: string
  gift_count?: number
  gift_value?: number
  gift_icon?: string
  /** 后端下发的富文本（含表情图） */
  content_parts?: ContentPart[]
  room_id?: string
  ts?: number
  extra?: Record<string, unknown>
  /** 前端聚合：弹幕重复次数 */
  repeat?: number
  /** 前端列表稳定 key */
  uid?: string
}

export type {
  TriggerKind,
  RuleTrigger,
  EffectMode,
  EffectTimesMode,
  ActionCategory,
  MouseOp,
  OtherOp,
  RepeatCountMode,
  RuleAction,
  PrankRule,
  FiredAction,
} from './lib/prank/model'
