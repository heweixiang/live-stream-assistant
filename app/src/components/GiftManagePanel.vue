<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { giftFallbackIcon } from '../lib/douyinEmoji'
import { loadStaticGifts, syncOfficialGiftsFromApi, type StaticGift } from '../lib/douyinGifts'
import { useGiftDiamondOverrides } from '../lib/useGiftDiamondOverrides'
import {
  clearGiftCountsByRange,
  giftCountDayKey,
  loadGiftCatalog,
  saveGiftCatalog,
  type GiftCatalogItem,
  type GiftClearRangeMode,
} from '../lib/storage'

const emit = defineEmits<{ hint: [string] }>()

const { overrides, setDiamond, resolve, reload: reloadOverrides } = useGiftDiamondOverrides()

const staticGifts = ref<StaticGift[]>([])
const catalog = ref<GiftCatalogItem[]>([])
const filter = ref('')
/** 所有天收到过 */
const onlyReceived = ref(false)
/** 今天收到过 */
const onlyTodayReceived = ref(false)
const onlyOverridden = ref(false)
const loading = ref(false)
const draftDiamond = ref<Record<string, number>>({})
const clearMode = ref<GiftClearRangeMode>('today')
const clearFrom = ref('')
const clearTo = ref('')

const clearModeOptions: { value: GiftClearRangeMode; label: string }[] = [
  { value: 'today', label: '仅今日' },
  { value: '7d', label: '近7天' },
  { value: '30d', label: '近30天' },
  { value: 'all', label: '全部累计' },
  { value: 'custom', label: '自定义区间' },
]

type Row = {
  name: string
  icon: string
  /** 累计 */
  count: number
  /** 今日 */
  todayCount: number
  lastAt: number
  official: number
  diamond: number
  panel: boolean
  overridden: boolean
}

const rows = computed(() => {
  const catMap = new Map(catalog.value.map((g) => [g.name, g]))
  const out: Row[] = []
  const seen = new Set<string>()

  for (const g of staticGifts.value) {
    const c = catMap.get(g.name)
    const official = g.diamond || 0
    const diamond = resolve(g.name, official)
    out.push({
      name: g.name,
      icon: g.icon || c?.icon || giftFallbackIcon(g.name),
      count: c?.count || 0,
      todayCount: c?.todayCount || 0,
      lastAt: c?.lastAt || 0,
      official,
      diamond,
      panel: !!g.panel,
      overridden: overrides.value[g.name] != null,
    })
    seen.add(g.name)
  }
  for (const c of catalog.value) {
    if (seen.has(c.name)) continue
    const official = 0
    const diamond = resolve(c.name, official)
    out.push({
      name: c.name,
      icon: c.icon || giftFallbackIcon(c.name),
      count: c.count || 0,
      todayCount: c.todayCount || 0,
      lastAt: c.lastAt || 0,
      official,
      diamond,
      panel: false,
      overridden: overrides.value[c.name] != null,
    })
  }

  let list = out
  const q = filter.value.trim()
  if (q) list = list.filter((r) => r.name.includes(q))
  if (onlyTodayReceived.value) list = list.filter((r) => r.todayCount > 0)
  else if (onlyReceived.value) list = list.filter((r) => r.count > 0)
  if (onlyOverridden.value) list = list.filter((r) => r.overridden)

  // 收到过（今日优先）→ 常见面板 → 其它；同组内次数多/官价低在前
  return list.sort(
    (a, b) =>
      Number(b.todayCount > 0) - Number(a.todayCount > 0) ||
      b.todayCount - a.todayCount ||
      Number(b.count > 0) - Number(a.count > 0) ||
      b.count - a.count ||
      Number(b.panel) - Number(a.panel) ||
      Number(b.overridden) - Number(a.overridden) ||
      a.official - b.official ||
      a.name.localeCompare(b.name, 'zh'),
  )
})

const stats = computed(() => {
  const todayList = catalog.value.filter((g) => (g.todayCount || 0) > 0)
  const received = catalog.value.filter((g) => g.count > 0)
  const todayCount = todayList.reduce((s, g) => s + (g.todayCount || 0), 0)
  const totalCount = received.reduce((s, g) => s + (g.count || 0), 0)
  return {
    todayKinds: todayList.length,
    todayCount,
    receivedKinds: received.length,
    totalCount,
    overrideCount: Object.keys(overrides.value).length,
    officialCount: staticGifts.value.length,
  }
})

async function reloadAll(forceOfficial = false) {
  loading.value = true
  try {
    catalog.value = loadGiftCatalog()
    saveGiftCatalog(catalog.value)
    reloadOverrides()
    if (forceOfficial) {
      const res = await syncOfficialGiftsFromApi()
      staticGifts.value = await loadStaticGifts()
      if (!res.ok) {
        emit('hint', res.error || '同步官价失败')
      } else if (res.source === 'official') {
        emit('hint', `已从官方接口同步（${res.count}，${res.updatedAt}）`)
      } else {
        emit('hint', res.error || `已重载目录（${res.count}）`)
      }
    } else {
      staticGifts.value = await loadStaticGifts()
    }
    draftDiamond.value = {}
  } finally {
    loading.value = false
  }
}

function clearAllCounts() {
  const mode = clearMode.value
  const label = clearModeOptions.find((o) => o.value === mode)?.label || mode
  if (mode === 'custom' && !clearFrom.value) {
    emit('hint', '请选择自定义起始日期')
    return
  }
  if (!confirm(`确认清零「${label}」范围内的收到次数？自定义抖钻不会丢。`)) return
  const next = clearGiftCountsByRange(catalog.value, {
    mode,
    from: clearFrom.value,
    to: clearTo.value || clearFrom.value,
  })
  persistCatalog(next)
  emit('hint', `已清零：${label}`)
}

function draftOf(row: Row) {
  if (draftDiamond.value[row.name] != null) return draftDiamond.value[row.name]
  return row.diamond
}

function onDraftInput(name: string, raw: string) {
  const n = Number(raw)
  draftDiamond.value = {
    ...draftDiamond.value,
    [name]: Number.isFinite(n) && n >= 0 ? Math.round(n) : 0,
  }
}

function applyDiamond(row: Row) {
  const n = draftOf(row)
  if (!Number.isFinite(n) || n < 0) {
    emit('hint', '请输入有效抖钻数')
    return
  }
  setDiamond(row.name, n)
  const { [row.name]: _, ...rest } = draftDiamond.value
  draftDiamond.value = rest
  emit('hint', `已保存「${row.name}」= ${n} 抖钻`)
}

function resetDiamond(row: Row) {
  setDiamond(row.name, null)
  const { [row.name]: _, ...rest } = draftDiamond.value
  draftDiamond.value = rest
  emit('hint', `「${row.name}」已恢复官价 ${row.official}`)
}

function persistCatalog(next: GiftCatalogItem[]) {
  catalog.value = next
  saveGiftCatalog(next)
}

function resetCount(row: Row) {
  if (!confirm(`清零「${row.name}」的今日次数？累计次数保留。`)) return
  const day = giftCountDayKey()
  persistCatalog(
    catalog.value.map((g) => {
      if (g.name !== row.name) return g
      const daily = { ...(g.daily || {}) }
      delete daily[day]
      let count = 0
      for (const v of Object.values(daily)) count += Number(v) || 0
      return { ...g, daily, todayCount: 0, count, countDay: day }
    }),
  )
  emit('hint', `已清零「${row.name}」今日次数`)
}

onMounted(() => {
  void reloadAll(false)
})
</script>

<template>
  <div class="gift-manage">
    <Teleport to="#gift-manage-head">
      <div class="head-tools">
        <div class="stats">
          <span>今日 <strong>{{ stats.todayKinds }}</strong> 种 / {{ stats.todayCount }} 次</span>
          <span>累计 <strong>{{ stats.receivedKinds }}</strong> 种 / {{ stats.totalCount }} 次</span>
          <span>改价 <strong>{{ stats.overrideCount }}</strong></span>
          <span>目录 <strong>{{ stats.officialCount }}</strong></span>
        </div>
        <div class="toolbar">
          <input v-model="filter" class="search" placeholder="搜索礼物名" />
          <label class="chk">
            <input v-model="onlyReceived" type="checkbox" :disabled="onlyTodayReceived" />
            只看收到过
          </label>
          <label class="chk">
            <input v-model="onlyTodayReceived" type="checkbox" />
            今天收到过
          </label>
          <label class="chk">
            <input v-model="onlyOverridden" type="checkbox" />
            只看改过价
          </label>
          <button type="button" class="ghost" :disabled="loading" @click="reloadAll(true)">
            {{ loading ? '同步中…' : '同步官价' }}
          </button>
          <select v-model="clearMode" class="clear-range" title="清零时间范围">
            <option v-for="o in clearModeOptions" :key="o.value" :value="o.value">
              {{ o.label }}
            </option>
          </select>
          <template v-if="clearMode === 'custom'">
            <input v-model="clearFrom" class="date" type="date" title="起始" />
            <span class="date-sep">~</span>
            <input v-model="clearTo" class="date" type="date" title="结束" />
          </template>
          <button type="button" class="ghost danger" @click="clearAllCounts">清零次数</button>
        </div>
      </div>
    </Teleport>

    <div class="list-wrap scroll">
      <div v-if="!rows.length" class="empty">
        {{
          onlyTodayReceived
            ? '今天还没有收到礼物'
            : onlyReceived
              ? '还没有收到过礼物记录'
              : '没有匹配的礼物'
        }}
      </div>
      <div v-else class="gift-grid">
        <div v-for="r in rows" :key="r.name" class="gift-row" :class="{ on: r.overridden }">
          <img class="ico" :src="r.icon" :alt="r.name" referrerpolicy="no-referrer" loading="lazy" />
          <div class="meta">
            <div class="title">
              <strong :title="r.name">{{ r.name }}</strong>
              <small v-if="r.overridden" class="tag">已改价</small>
            </div>
            <div class="sub">
              今日
              <b :class="r.todayCount > 0 ? 'today-on' : 'today-off'">{{ r.todayCount }}</b>
              <span class="sep">·</span>
              累计 {{ r.count }}
              <span class="sep">·</span>
              官价 {{ r.official }}
            </div>
          </div>
          <label class="price">
            <span>抖钻</span>
            <input
              type="number"
              min="0"
              step="1"
              :value="draftOf(r)"
              @input="onDraftInput(r.name, ($event.target as HTMLInputElement).value)"
            />
          </label>
          <div class="acts">
            <button type="button" class="mini primary" @click="applyDiamond(r)">保存</button>
            <button
              v-if="r.overridden || draftOf(r) !== r.official"
              type="button"
              class="mini"
              @click="resetDiamond(r)"
            >
              恢复
            </button>
            <button
              v-if="r.todayCount > 0"
              type="button"
              class="mini ghost"
              @click="resetCount(r)"
            >
              清零今日
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gift-manage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  flex: 1;
  height: 100%;
}

.head-tools {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 12px;
  color: var(--muted);
}

.stats strong {
  color: var(--accent-2);
  font-weight: 600;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.search {
  width: 140px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 12px;
}

.clear-range,
.date {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 12px;
}

.clear-range {
  max-width: 110px;
}

.date {
  width: 128px;
}

.date-sep {
  color: var(--muted);
  font-size: 12px;
}

.chk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}

.chk input {
  accent-color: var(--accent);
}

.ghost,
.mini {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}

.ghost.danger:hover {
  border-color: rgba(255, 100, 100, 0.45);
  color: #ff8f8f;
}

.mini {
  padding: 3px 8px;
  border-radius: 6px;
}

.mini.primary {
  border-color: rgba(255, 138, 61, 0.45);
  background: rgba(255, 138, 61, 0.18);
  color: var(--accent-2);
}

.list-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.16);
  padding: 8px;
}

.gift-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
  align-content: start;
}

.gift-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
}

.gift-row.on {
  border-color: rgba(255, 138, 61, 0.35);
  background: rgba(255, 138, 61, 0.08);
}

.gift-row .ico {
  width: 28px;
  height: 28px;
  object-fit: contain;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.25);
}

.meta {
  min-width: 0;
}

.title {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}

.title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.title small {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--muted);
}

.title .tag {
  color: var(--accent-2);
}

.sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--muted);
}

.sub b {
  font-weight: 600;
}

.sub b.today-on {
  color: #8dffa0;
}

.sub b.today-off {
  color: #ff8f8f;
}

.sub .sep {
  margin: 0 4px;
  opacity: 0.5;
}

.price {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
}

.price input {
  width: 48px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  border-radius: 6px;
  padding: 3px 4px;
  text-align: right;
  font-size: 12px;
}

.acts {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
}

.empty {
  text-align: center;
  color: var(--muted);
  padding: 28px 12px;
  font-size: 12px;
}

@media (max-width: 980px) {
  .gift-grid {
    grid-template-columns: 1fr;
  }
}
</style>
