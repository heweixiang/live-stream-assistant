<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ActionEditor from './ActionEditor.vue'
import {
  TRIGGER_OPTIONS,
  actionSummary,
  createEmptyAction,
  createEmptyRule,
  newActionId,
  type EffectMode,
  type PrankRule,
  type RuleAction,
  type TriggerKind,
} from '../lib/prank/model'
import { loadDefaultRules } from '../lib/prank/migrate'
import { runRuleEffects, testAction } from '../lib/prank/actionRunner'
import { giftFallbackIcon } from '../lib/douyinEmoji'
import { usePrankMaster } from '../composables/usePrankMaster'

const props = defineProps<{
  /** 全量/本场礼物目录，供触发条件点选（名称精确匹配） */
  giftOptions?: {
    name: string
    icon?: string
    count?: number
    panel?: boolean
    diamond?: number
  }[]
}>()

const rules = defineModel<PrankRule[]>('rules', { required: true })

const emit = defineEmits<{
  toast: [string]
}>()

const { prankMasterEnabled } = usePrankMaster()

const selectedId = ref(rules.value[0]?.id || '')
const editorOpen = ref(false)
/** 规则测试倒计时剩余秒数；>0 表示倒计时中 */
const testCountdown = ref(0)
let testCountdownTimer: ReturnType<typeof setInterval> | null = null
let testCountdownResolve: ((ok: boolean) => void) | null = null

function clearTestCountdown(cancelled = true) {
  if (testCountdownTimer) {
    clearInterval(testCountdownTimer)
    testCountdownTimer = null
  }
  testCountdown.value = 0
  if (cancelled && testCountdownResolve) {
    const resolve = testCountdownResolve
    testCountdownResolve = null
    resolve(false)
  }
}

onBeforeUnmount(() => clearTestCountdown())
const editingAction = ref<RuleAction | null>(null)
const editingIndex = ref(-1)

watch(
  rules,
  (list) => {
    if (!list.find((r) => r.id === selectedId.value)) {
      selectedId.value = list[0]?.id || ''
    }
  },
  { deep: true },
)

const current = computed(() => rules.value.find((r) => r.id === selectedId.value) || null)

const giftFilter = ref('')

/** 礼物点选列表；无关键词时优先面板/本场，搜索时查全库 */
const giftSelectOptions = computed(() => {
  const seen = new Set<string>()
  const out: { name: string; icon: string; count: number; panel: boolean; diamond: number }[] = []
  for (const g of props.giftOptions || []) {
    const n = (g.name || '').trim()
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push({
      name: n,
      icon: g.icon || giftFallbackIcon(n),
      count: g.count || 0,
      panel: !!g.panel,
      diamond: g.diamond || 0,
    })
  }
  const cur = current.value?.trigger?.giftName?.trim()
  if (cur && !seen.has(cur)) {
    out.unshift({ name: cur, icon: giftFallbackIcon(cur), count: 0, panel: false, diamond: 0 })
  }
  const q = giftFilter.value.trim()
  if (q) return out.filter((g) => g.name.includes(q))
  // 无搜索：本场收到过 + 面板常见礼物，避免一次渲染上千个
  const received = out.filter((g) => g.count > 0)
  const receivedNames = new Set(received.map((g) => g.name))
  const panel = out
    .filter((g) => g.panel && !receivedNames.has(g.name))
    .sort((a, b) => a.diamond - b.diamond || a.name.localeCompare(b.name, 'zh'))
  return [...received, ...panel]
})

const selectedGift = computed(() => {
  const name = current.value?.trigger?.giftName?.trim() || ''
  if (!name) return null
  const hit = (props.giftOptions || []).find((g) => g.name === name)
  return {
    name,
    icon: hit?.icon || giftFallbackIcon(name),
  }
})

function pickGift(name: string) {
  const rule = current.value
  if (!rule) return
  // 整对象替换，确保写入规则并落盘
  rule.trigger = { ...rule.trigger, giftName: name }
}

function giftIconOf(name: string, icon?: string) {
  return icon || giftFallbackIcon(name)
}

function select(id: string) {
  if (id !== selectedId.value) clearTestCountdown()
  selectedId.value = id
}

function addRule() {
  const rule = createEmptyRule(`玩法${rules.value.length + 1}`)
  rules.value = [...rules.value, rule]
  selectedId.value = rule.id
}

function removeRule(id: string) {
  const idx = rules.value.findIndex((r) => r.id === id)
  if (idx < 0) return
  const next = rules.value.filter((r) => r.id !== id)
  rules.value = next
  if (selectedId.value === id) selectedId.value = next[Math.max(0, idx - 1)]?.id || ''
}

/** 拖拽排序 */
const dragFrom = ref(-1)
const dragOver = ref(-1)

function onDragStart(index: number, e: DragEvent) {
  dragFrom.value = index
  dragOver.value = index
  e.dataTransfer?.setData('text/plain', String(index))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(index: number, e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dragOver.value = index
}

function onDrop(index: number) {
  const from = dragFrom.value
  if (from < 0 || from === index) {
    onDragEnd()
    return
  }
  const next = [...rules.value]
  const [item] = next.splice(from, 1)
  next.splice(index, 0, item)
  rules.value = next
  onDragEnd()
}

function onDragEnd() {
  dragFrom.value = -1
  dragOver.value = -1
}

function toggleEnabled(rule: PrankRule, checked: boolean) {
  rule.enabled = checked
}

function restoreDefaults() {
  if (!confirm('恢复默认玩法列表？当前配置会被覆盖。')) return
  rules.value = loadDefaultRules()
  selectedId.value = rules.value[0]?.id || ''
}

function setTriggerKind(kind: TriggerKind) {
  if (!current.value) return
  current.value.trigger.kind = kind
}

function keywordsText(rule: PrankRule) {
  return (rule.trigger.keywords ?? []).join('，')
}

function updateKeywords(rule: PrankRule, text: string) {
  rule.trigger.keywords = text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function addEffect() {
  if (!current.value) return
  editingIndex.value = -1
  editingAction.value = createEmptyAction('keyboard')
  editorOpen.value = true
}

function editEffect(i: number) {
  if (!current.value) return
  editingIndex.value = i
  const src = current.value.actions[i]
  editingAction.value = JSON.parse(JSON.stringify(src)) as RuleAction
  editorOpen.value = true
}

function saveEffect(action: RuleAction) {
  const rule = current.value
  if (!rule) return
  const list = [...(rule.actions || [])]
  const normalized = {
    ...action,
    id: action.id || newActionId(),
    enabled: action.enabled !== false,
  }
  if (editingIndex.value >= 0) list[editingIndex.value] = normalized
  else list.push(normalized)
  const idx = rules.value.findIndex((r) => r.id === rule.id)
  if (idx < 0) return
  const next = [...rules.value]
  next[idx] = { ...rule, actions: list }
  rules.value = next
}

function removeEffect(i: number) {
  if (!current.value) return
  current.value.actions = current.value.actions.filter((_, idx) => idx !== i)
}

/** 效果列表拖拽 */
const effectDragFrom = ref(-1)
const effectDragOver = ref(-1)

function onEffectDragStart(index: number, e: DragEvent) {
  effectDragFrom.value = index
  effectDragOver.value = index
  e.dataTransfer?.setData('text/plain', String(index))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onEffectDragOver(index: number, e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  effectDragOver.value = index
}

function onEffectDrop(index: number) {
  const from = effectDragFrom.value
  if (!current.value || from < 0 || from === index) {
    onEffectDragEnd()
    return
  }
  const list = [...current.value.actions]
  const [item] = list.splice(from, 1)
  list.splice(index, 0, item)
  current.value.actions = list
  onEffectDragEnd()
}

function onEffectDragEnd() {
  effectDragFrom.value = -1
  effectDragOver.value = -1
}

function toggleActionEnabled(action: RuleAction, checked: boolean) {
  action.enabled = checked
}

async function testRule() {
  if (!current.value) return
  if (testCountdown.value > 0) return

  clearTestCountdown()
  const rule = current.value
  testCountdown.value = 5
  emit('toast', `测试将在 5 秒后触发：${rule.name}`)

  const ok = await new Promise<boolean>((resolve) => {
    testCountdownResolve = resolve
    testCountdownTimer = setInterval(() => {
      testCountdown.value -= 1
      if (testCountdown.value <= 0) {
        if (testCountdownTimer) {
          clearInterval(testCountdownTimer)
          testCountdownTimer = null
        }
        testCountdown.value = 0
        const done = testCountdownResolve
        testCountdownResolve = null
        done?.(true)
      } else {
        emit('toast', `测试倒计时 ${testCountdown.value} 秒…`)
      }
    }, 1000)
  })

  if (!ok) return
  emit('toast', `测试触发：${rule.name}`)
  await runRuleEffects(rule, 1, 0, {
    dryToast: (m) => emit('toast', m),
  })
}

async function testOne(action: RuleAction) {
  await testAction(action, { dryToast: (m) => emit('toast', m) })
}

function effectModeOf(rule: PrankRule): EffectMode {
  return rule.effectMode || 'sequential'
}

function categoryLabel(cat: string) {
  const map: Record<string, string> = {
    keyboard: '键盘',
    mouse: '鼠标',
    sound: '播放声音',
    video: '视频',
    desktop_video: '桌面视频',
    key_replay: '按键回放',
    obs_source: 'OBS来源',
    obs_filter: 'OBS滤镜',
    hardware: '硬件',
    other: '系统操作',
  }
  return map[cat] || cat
}
</script>

<template>
  <section class="studio">
    <header class="toolbar">
      <div class="tabs">
        <span class="on">玩法列表</span>
        <label class="master" :class="{ off: !prankMasterEnabled }" title="关闭后所有玩法都不会被直播事件触发（测试按钮仍可用）">
          <input v-model="prankMasterEnabled" type="checkbox" />
          <span>开启整蛊</span>
        </label>
      </div>
      <div class="ops">
        <button type="button" @click="restoreDefaults">恢复默认</button>
      </div>
    </header>

    <div class="body">
      <aside class="side">
        <div
          v-for="(r, i) in rules"
          :key="r.id"
          class="item"
          :class="{
            on: r.id === selectedId,
            off: !r.enabled,
            dragging: dragFrom === i,
            'drag-over': dragOver === i && dragFrom !== i,
          }"
          @dragover="onDragOver(i, $event)"
          @drop="onDrop(i)"
          @click="select(r.id)"
        >
          <label class="en" title="勾选后才会被直播事件触发" @click.stop>
            <input
              type="checkbox"
              :checked="r.enabled"
              @change="toggleEnabled(r, ($event.target as HTMLInputElement).checked)"
            />
          </label>
          <span
            class="grip"
            title="拖动排序"
            draggable="true"
            @dragstart="onDragStart(i, $event)"
            @dragend="onDragEnd"
            @click.stop
          >⠿</span>
          <span class="name">{{ r.name || `玩法${i + 1}` }}</span>
          <span class="row-ops" @click.stop>
            <button type="button" title="删除" @click="removeRule(r.id)">×</button>
          </span>
        </div>
        <button type="button" class="add" @click="addRule">+ 添加</button>
      </aside>

      <div v-if="current" class="editor scroll">
        <div class="line">
          <label class="grow">
            <span>名称</span>
            <input v-model="current.name" />
          </label>
          <div class="test-wrap">
            <div v-if="testCountdown > 0" class="test-cd" aria-live="polite">
              <strong>{{ testCountdown }}</strong>
              <span>秒后触发</span>
            </div>
            <button
              type="button"
              class="primary"
              :disabled="testCountdown > 0"
              @click="testRule"
            >
              {{ testCountdown > 0 ? `倒计时 ${testCountdown}` : '测试' }}
            </button>
          </div>
        </div>

        <fieldset class="box">
          <legend>触发条件</legend>
          <div class="triggers">
            <label
              v-for="t in TRIGGER_OPTIONS"
              :key="t.value"
              class="tg"
              :class="{ on: current.trigger.kind === t.value, dim: !t.ready }"
            >
              <input
                type="radio"
                :checked="current.trigger.kind === t.value"
                :disabled="!t.ready"
                @change="setTriggerKind(t.value)"
              />
              {{ t.label }}{{ t.ready ? '' : '·待' }}
            </label>
          </div>

          <div v-if="current.trigger.kind === 'chat'" class="params">
            <label>
              <span>关键词（逗号分隔）</span>
              <input
                :value="keywordsText(current)"
                @input="updateKeywords(current, ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>

          <div v-else-if="current.trigger.kind === 'gift'" class="params gift-params">
            <div class="gift-picker">
              <div class="gift-selected">
                <template v-if="selectedGift">
                  <img
                    class="gift-ico lg"
                    :src="selectedGift.icon"
                    alt=""
                    referrerpolicy="no-referrer"
                  />
                  <div class="sel-text">
                    <small>已选触发礼物（精确匹配）</small>
                    <strong>{{ selectedGift.name }}</strong>
                  </div>
                  <button type="button" class="any-gift" @click="pickGift('')">改为任意礼物</button>
                </template>
                <template v-else>
                  <div class="sel-text">
                    <small>触发礼物</small>
                    <strong class="muted">未指定 · 任意礼物都会触发</strong>
                  </div>
                </template>
              </div>
              <div class="gift-picker-head">
                <span>点选下方礼物设为触发条件</span>
                <input
                  v-model="giftFilter"
                  class="gift-filter"
                  placeholder="搜索全部礼物（约1500+）"
                />
              </div>
              <div class="gift-grid scroll">
                <button
                  v-for="g in giftSelectOptions"
                  :key="g.name"
                  type="button"
                  class="gift-card"
                  :class="{ on: current.trigger.giftName === g.name }"
                  :title="`选择「${g.name}」`"
                  @click="pickGift(g.name)"
                >
                  <img
                    class="gift-ico"
                    :src="giftIconOf(g.name, g.icon)"
                    :alt="g.name"
                    referrerpolicy="no-referrer"
                    loading="lazy"
                  />
                  <span class="gift-name">{{ g.name }}</span>
                </button>
                <p v-if="!giftSelectOptions.length" class="hint-inline">
                  {{ giftFilter.trim() ? '没有匹配的礼物名，换个关键词试试' : '礼物目录加载中…' }}
                </p>
              </div>
            </div>
            <label class="field-count">
              <span>数量 ≥</span>
              <input v-model.number="current.trigger.giftCount" type="number" min="1" />
            </label>
          </div>

          <div v-else-if="current.trigger.kind === 'gift_value' || current.trigger.kind === 'gift_value_sum'" class="params">
            <label>
              <span>{{ current.trigger.kind === 'gift_value_sum' ? '累计价值 ≥' : '单次价值 ≥' }}</span>
              <input v-model.number="current.trigger.minValue" type="number" min="1" />
            </label>
          </div>

          <div v-else-if="current.trigger.kind === 'like'" class="params">
            <label>
              <span>点赞数 ≥</span>
              <input v-model.number="current.trigger.likeCount" type="number" min="1" />
            </label>
          </div>

          <div v-else-if="current.trigger.kind === 'like_total'" class="params">
            <label>
              <span>房间点赞总数 ≥</span>
              <input v-model.number="current.trigger.likeTotal" type="number" min="1" />
            </label>
          </div>

          <div class="params extras">
            <label class="check full">
              <input v-model="current.trigger.multiByGiftCount" type="checkbox" />
              根据礼物数量触发多次
            </label>
            <label class="field">
              <span>间隔(秒)</span>
              <input v-model.number="current.trigger.multiIntervalSec" type="number" min="0" step="0.1" />
            </label>
            <label class="field">
              <span>同用户冷却(秒)</span>
              <input v-model.number="current.trigger.userCooldownSec" type="number" min="0" />
            </label>
            <label class="field">
              <span>规则冷却(秒)</span>
              <input v-model.number="current.cooldownSec" type="number" min="0" />
            </label>
          </div>
        </fieldset>

        <fieldset class="box">
          <legend>触发效果</legend>
          <div class="modes">
            <label class="tg" :class="{ on: effectModeOf(current) === 'sequential' }">
              <input v-model="current.effectMode" type="radio" value="sequential" />
              顺序触发
            </label>
            <label class="tg" :class="{ on: effectModeOf(current) === 'parallel' }">
              <input v-model="current.effectMode" type="radio" value="parallel" />
              同时触发
            </label>
            <label class="tg" :class="{ on: effectModeOf(current) === 'random' }">
              <input v-model="current.effectMode" type="radio" value="random" />
              随机触发
            </label>
          </div>

          <div class="effect-list">
            <div
              v-for="(a, i) in current.actions"
              :key="a.id"
              class="effect-row"
              :class="{
                off: a.enabled === false,
                dragging: effectDragFrom === i,
                'drag-over': effectDragOver === i && effectDragFrom !== i,
              }"
              @dragover="onEffectDragOver(i, $event)"
              @drop="onEffectDrop(i)"
            >
              <label class="en" title="勾选后才会执行该效果" @click.stop>
                <input
                  type="checkbox"
                  :checked="a.enabled !== false"
                  @change="toggleActionEnabled(a, ($event.target as HTMLInputElement).checked)"
                />
              </label>
              <span
                class="grip"
                title="拖动排序"
                draggable="true"
                @dragstart="onEffectDragStart(i, $event)"
                @dragend="onEffectDragEnd"
                @click.stop
              >⠿</span>
              <span class="effect-cat">{{ categoryLabel(a.category) }}</span>
              <span class="effect-sum">{{ actionSummary(a) }}</span>
              <span class="row-ops" @click.stop>
                <button type="button" @click="testOne(a)">测</button>
                <button type="button" @click="editEffect(i)">改</button>
                <button type="button" @click="removeEffect(i)">删</button>
              </span>
            </div>
            <p v-if="!current.actions.length" class="hint-inline">还没有效果，点下方添加</p>
          </div>
          <button type="button" class="add-effect" @click="addEffect">添加效果</button>
        </fieldset>
      </div>

      <div v-else class="empty">先在左侧添加一条玩法</div>
    </div>

    <ActionEditor v-model="editorOpen" :action="editingAction" @save="saveEffect" />
  </section>
</template>

<style scoped>
.studio {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}

.tabs {
  display: flex;
  align-items: center;
  gap: 14px;
}

.tabs .on {
  font-size: 14px;
  font-weight: 600;
}

.master {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  user-select: none;
  font-weight: 500;
}

.master input {
  width: 14px;
  height: 14px;
  accent-color: #ff8a3d;
  cursor: pointer;
}

.master.off {
  color: var(--muted);
}

.ops button {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
}

.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px 1fr;
}

.side {
  border-right: 1px solid var(--line);
  overflow: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  border: 1px solid transparent;
}

.item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.item.on {
  background: rgba(255, 138, 61, 0.16);
}

.item.off .name {
  opacity: 0.45;
}

.item.dragging {
  opacity: 0.45;
}

.item.drag-over {
  border-color: rgba(255, 138, 61, 0.55);
  background: rgba(255, 138, 61, 0.1);
}

.en {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}

.en input {
  width: 14px;
  height: 14px;
  accent-color: #ff8a3d;
  cursor: pointer;
}

.grip {
  color: var(--muted);
  font-size: 12px;
  line-height: 1;
  user-select: none;
  flex-shrink: 0;
  letter-spacing: -2px;
  cursor: grab;
  padding: 2px 1px;
}

.grip:active {
  cursor: grabbing;
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-ops {
  display: inline-flex;
  gap: 2px;
}

.row-ops button,
.acts button {
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 2px 4px;
  font-size: 12px;
}

.add,
.add-effect {
  margin-top: 8px;
  border: 1px dashed rgba(255, 138, 61, 0.45);
  background: rgba(255, 138, 61, 0.08);
  color: var(--accent-2);
  border-radius: 8px;
  padding: 10px;
  font-size: 13px;
}

.add-effect {
  width: 100%;
}

.editor {
  padding: 14px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.line {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.test-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 88px;
}

.test-cd {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 138, 61, 0.18);
  border: 1px solid rgba(255, 138, 61, 0.55);
  color: var(--accent-2);
  font-size: 12px;
  line-height: 1.2;
  animation: cd-pulse 1s ease-in-out infinite;
}

.test-cd strong {
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

@keyframes cd-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.06);
    opacity: 0.85;
  }
}

.line label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.line input {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 10px;
  outline: none;
}

.grow {
  flex: 1;
  min-width: 160px;
}

.hotkey {
  width: 120px;
}

.switch {
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  flex-direction: row !important;
  padding-bottom: 8px;
}

.primary {
  border: 0;
  border-radius: 8px;
  padding: 8px 16px;
  background: linear-gradient(135deg, var(--accent), #ffb15a);
  color: #1a120c;
  font-weight: 600;
  height: 36px;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.box {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px 14px;
}

.box legend {
  padding: 0 6px;
  font-size: 13px;
}

.triggers,
.modes {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 10px;
}

.tg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  cursor: pointer;
}

.tg.dim {
  opacity: 0.45;
}

.tg.on {
  color: var(--accent-2);
}

.tg input[type='radio'],
.check input[type='checkbox'],
.modes input[type='radio'] {
  accent-color: var(--accent);
}

.params {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.params.gift-params {
  flex-direction: column;
  align-items: stretch;
}

.field-count {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  max-width: 200px;
}

.field-count input,
.field input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 10px;
  outline: none;
}

.params.extras {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px 12px;
  align-items: end;
}

.params.extras .check.full {
  grid-column: 1 / -1;
}

.params.extras .field {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  min-width: 0;
}

.gift-picker {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gift-picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}

.gift-filter {
  width: 140px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
}

.gift-selected {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 138, 61, 0.35);
  background: rgba(255, 138, 61, 0.1);
}

.gift-selected .sel-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gift-selected small {
  color: var(--muted);
  font-size: 11px;
}

.gift-selected strong {
  color: var(--accent-2);
  font-size: 14px;
}

.gift-selected strong.muted {
  color: var(--muted);
  font-weight: 500;
}

.gift-ico.lg {
  width: 36px;
  height: 36px;
}

.any-gift {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}

.any-gift:hover {
  color: var(--accent-2);
  border-color: rgba(255, 138, 61, 0.45);
  background: rgba(255, 138, 61, 0.12);
}

.gift-grid {
  max-height: 168px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
}

.gift-card {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  padding: 8px 10px;
  text-align: left;
  color: var(--text);
  cursor: pointer;
  min-height: 44px;
}

.gift-card:hover {
  border-color: rgba(255, 214, 170, 0.22);
  background: rgba(255, 255, 255, 0.05);
}

.gift-card.on {
  border-color: rgba(255, 138, 61, 0.55);
  background: rgba(255, 138, 61, 0.18);
  box-shadow: inset 0 0 0 1px rgba(255, 168, 80, 0.2);
}

.gift-ico {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 6px;
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.2);
}

.gift-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.params label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
  min-width: 0;
}

.params input,
.params select {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 7px 9px;
  outline: none;
}

.params select {
  cursor: pointer;
}

.params .grow {
  flex: 1 1 220px;
}

.hint-inline {
  color: var(--muted);
  font-size: 11px;
  opacity: 0.85;
}

.check {
  display: inline-flex !important;
  align-items: center;
  gap: 6px;
  flex-direction: row !important;
  grid-template-columns: none !important;
  min-width: auto !important;
  flex: 0 0 auto !important;
  color: var(--text) !important;
  padding-bottom: 0;
}

.effect-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}

.effect-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.03);
  min-width: 0;
}

.effect-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.effect-row.off .effect-sum,
.effect-row.off .effect-cat {
  opacity: 0.45;
}

.effect-row.dragging {
  opacity: 0.45;
}

.effect-row.drag-over {
  border-color: rgba(255, 138, 61, 0.55);
  background: rgba(255, 138, 61, 0.1);
}

.effect-cat {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 12px;
  min-width: 4.5em;
}

.effect-sum {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text);
}

.empty {
  display: grid;
  place-items: center;
  color: var(--muted);
}
</style>
