/** 抖音弹幕里的 [表情名] → 展示用 emoji（无图时的兜底） */

const EMOJI_MAP: Record<string, string> = {
  爱心: '❤️',
  心: '❤️',
  小心心: '💗',
  示爱: '💘',
  心碎: '💔',
  赞: '👍',
  强: '👍',
  鼓掌: '👏',
  玫瑰: '🌹',
  花: '🌸',
  凋谢: '🥀',
  微笑: '🙂',
  捂脸: '🤦',
  流泪: '😢',
  大哭: '😭',
  大笑: '😂',
  色: '😍',
  亲亲: '😘',
  可怜: '🥺',
  呆住: '😲',
  呆无辜: '🐱',
  惊讶: '😮',
  害羞: '😊',
  偷笑: '😏',
  憨笑: '😁',
  坏笑: '😈',
  阴险: '😼',
  得意: '😎',
  酷: '😎',
  撇嘴: '😒',
  发怒: '😠',
  抓狂: '😫',
  吐: '🤮',
  哈欠: '🥱',
  睡: '😴',
  再见: '👋',
  拥抱: '🤗',
  加油: '💪',
  胜利: '✌️',
  握手: '🤝',
  抱拳: '🙏',
  OK: '👌',
  ok: '👌',
  拳头: '✊',
  勾引: '👆',
  礼物: '🎁',
  红包: '🧧',
  烟花: '🎆',
  啤酒: '🍺',
  咖啡: '☕',
  蛋糕: '🎂',
  月亮: '🌙',
  太阳: '☀️',
  星: '⭐',
  炸弹: '💣',
  弱: '👎',
  发呆: '😶',
  闭嘴: '🤐',
  尴尬: '😅',
  调皮: '😜',
  呲牙: '😁',
  难过: '😔',
  冷汗: '😰',
  白眼: '🙄',
  傲慢: '😤',
  困: '😪',
  惊恐: '😱',
  流汗: '😓',
  悠闲: '😌',
  奋斗: '😤',
  疑问: '❓',
  嘘: '🤫',
  晕: '😵',
  衰: '😞',
  敲打: '👊',
  擦汗: '😅',
  抠鼻: '👃',
  委屈: '😣',
  快哭了: '🥹',
  吓: '😨',
  西瓜: '🍉',
  篮球: '🏀',
  足球: '⚽',
  饭: '🍚',
  猪头: '🐷',
  便便: '💩',
  闪电: '⚡',
  刀: '🔪',
  跳跳: '🕺',
  发抖: '🥶',
  转圈: '🌀',
}

export type TextPart = { type: 'text' | 'emoji' | 'image'; value: string }

/** 把「[爱心][爱心]你好」拆成可渲染片段 */
export function parseDouyinEmojiText(input: string): TextPart[] {
  if (!input) return []
  const parts: TextPart[] = []
  const re = /\[([^\]]+)\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) {
    if (m.index > last) {
      parts.push({ type: 'text', value: input.slice(last, m.index) })
    }
    const name = m[1]
    const emoji = EMOJI_MAP[name]
    parts.push(emoji ? { type: 'emoji', value: emoji } : { type: 'emoji', value: `:${name}:` })
    last = m.index + m[0].length
  }
  if (last < input.length) {
    parts.push({ type: 'text', value: input.slice(last) })
  }
  return parts.length ? parts : [{ type: 'text', value: input }]
}

/** 合并后端富文本 + 本地 [表情] 映射 */
export function resolveChatParts(
  content?: string,
  backendParts?: TextPart[],
): TextPart[] {
  if (backendParts?.length) {
    // 后端若给了 image，直接用；纯 text 再跑一遍本地映射
    const out: TextPart[] = []
    for (const p of backendParts) {
      if (p.type === 'image') {
        out.push(p)
      } else if (p.type === 'text') {
        out.push(...parseDouyinEmojiText(p.value))
      } else {
        out.push(p)
      }
    }
    return out
  }
  return parseDouyinEmojiText(content || '')
}

/** 礼物名 → 本地兜底图标 */
export function giftFallbackIcon(giftName?: string): string {
  const n = giftName || ''
  if (/心|爱心|小心心/.test(n)) return '/gifts/heart.svg'
  if (/玫瑰|花/.test(n)) return '/gifts/rose.svg'
  if (/抖音/.test(n)) return '/gifts/douyin.svg'
  if (/车|跑车/.test(n)) return '/gifts/car.svg'
  if (/嘉年华|666/.test(n)) return '/gifts/carnival.svg'
  return '/gifts/heart.svg'
}
