/** OBS 整蛊叠层配置 */

export type OverlayRuleStyle = {
  ruleId: string
  /** 是否在 OBS 层展示 */
  visible: boolean
  /** 自定义显示名，空则用玩法名 */
  label?: string
  /** 图标 data URL / http */
  iconDataUrl?: string
  /** 显示数量 = 实际触发次数 + offset */
  countOffset?: number
}

export type OverlaySettings = {
  /** 启动本地叠层服务 */
  enabled: boolean
  port: number
  title: string
  showTitle: boolean
  showTotal: boolean
  /** 显示计数为 0 的玩法 */
  showZero: boolean
  /** 最多展示几条，0=全部 */
  maxItems: number
  panelWidth: number
  iconSize: number
  fontSize: number
  countFontSize: number
  gap: number
  /** 背景不透明度 0~1 */
  bgOpacity: number
  accentColor: string
  ruleStyles: OverlayRuleStyle[]
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  enabled: true,
  port: 8767,
  title: '整蛊统计',
  showTitle: true,
  showTotal: true,
  showZero: true,
  maxItems: 0,
  panelWidth: 360,
  iconSize: 28,
  fontSize: 16,
  countFontSize: 20,
  gap: 10,
  bgOpacity: 0.45,
  accentColor: '#ff8a3d',
  ruleStyles: [],
}

const KEY = 'live-assistant.overlaySettings'

function clamp(n: unknown, min: number, max: number, fallback: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

export function loadOverlaySettings(): OverlaySettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_OVERLAY_SETTINGS, ruleStyles: [] }
    const p = JSON.parse(raw) as Partial<OverlaySettings>
    const styles = Array.isArray(p.ruleStyles)
      ? p.ruleStyles
          .filter((x) => x && typeof x.ruleId === 'string')
          .map((x) => ({
            ruleId: String(x.ruleId),
            visible: x.visible !== false,
            label: x.label ? String(x.label) : '',
            iconDataUrl: x.iconDataUrl ? String(x.iconDataUrl) : '',
            countOffset: Number.isFinite(Number(x.countOffset)) ? Number(x.countOffset) : 0,
          }))
      : []
    return {
      ...DEFAULT_OVERLAY_SETTINGS,
      ...p,
      enabled: p.enabled !== false,
      port: clamp(p.port, 1024, 65535, 8767),
      title: String(p.title ?? DEFAULT_OVERLAY_SETTINGS.title),
      showTitle: p.showTitle !== false,
      showTotal: p.showTotal !== false,
      showZero: p.showZero !== false,
      maxItems: clamp(p.maxItems, 0, 50, 0),
      panelWidth: clamp(p.panelWidth, 160, 900, 360),
      iconSize: clamp(p.iconSize, 12, 96, 28),
      fontSize: clamp(p.fontSize, 10, 48, 16),
      countFontSize: clamp(p.countFontSize, 10, 64, 20),
      gap: clamp(p.gap, 0, 40, 10),
      bgOpacity: clamp(p.bgOpacity, 0, 1, 0.45),
      accentColor: String(p.accentColor || DEFAULT_OVERLAY_SETTINGS.accentColor),
      ruleStyles: styles,
    }
  } catch {
    return { ...DEFAULT_OVERLAY_SETTINGS, ruleStyles: [] }
  }
}

export function saveOverlaySettings(s: OverlaySettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
    void import('../diskSync').then((m) => m.scheduleFlushToDisk())
  } catch {
    // ignore
  }
}

export type OverlayRow = {
  ruleId: string
  name: string
  icon: string
  count: number
}

/** 根据玩法 + 本场触发记录/计数表 + 配置，生成 OBS 展示行 */
export function buildOverlayRows(
  rules: { id: string; name: string; enabled?: boolean }[],
  actions: { ruleId: string; ruleName?: string }[],
  settings: OverlaySettings,
  /** 可选：持久化累计次数，优先于 actions 重新统计 */
  ruleCounts?: Record<string, number>,
): OverlayRow[] {
  const countMap = new Map<string, number>()
  if (ruleCounts && Object.keys(ruleCounts).length) {
    for (const [id, n] of Object.entries(ruleCounts)) {
      countMap.set(id, Math.max(0, Number(n) || 0))
    }
  } else {
    for (const a of actions) {
      const id = a.ruleId || ''
      if (!id) continue
      countMap.set(id, (countMap.get(id) || 0) + 1)
    }
  }
  const styleMap = new Map(settings.ruleStyles.map((s) => [s.ruleId, s]))
  const rows: OverlayRow[] = []
  // 顺序与玩法列表一致（不按次数重排）
  for (const r of rules) {
    if (r.enabled === false) continue
    const st = styleMap.get(r.id)
    if (st && st.visible === false) continue
    const real = countMap.get(r.id) || 0
    const offset = st?.countOffset || 0
    const count = Math.max(0, real + offset)
    if (!settings.showZero && count <= 0) continue
    rows.push({
      ruleId: r.id,
      name: (st?.label || '').trim() || r.name || '未命名',
      icon: (st?.iconDataUrl || '').trim(),
      count,
    })
  }
  if (settings.maxItems > 0) return rows.slice(0, settings.maxItems)
  return rows
}

export function buildOverlayPayload(
  rules: { id: string; name: string; enabled?: boolean }[],
  actions: { ruleId: string; ruleName?: string }[],
  settings: OverlaySettings,
  ruleCounts?: Record<string, number>,
) {
  const rows = buildOverlayRows(rules, actions, settings, ruleCounts)
  const totalFromCounts = ruleCounts
    ? Object.values(ruleCounts).reduce((s, n) => s + Math.max(0, Number(n) || 0), 0)
    : actions.length
  return {
    title: settings.title,
    showTitle: settings.showTitle,
    showTotal: settings.showTotal,
    total: totalFromCounts,
    panelWidth: settings.panelWidth,
    iconSize: settings.iconSize,
    fontSize: settings.fontSize,
    countFontSize: settings.countFontSize,
    gap: settings.gap,
    bgOpacity: settings.bgOpacity,
    accentColor: settings.accentColor,
    rows,
  }
}
