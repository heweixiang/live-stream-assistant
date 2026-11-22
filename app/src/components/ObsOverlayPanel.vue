<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { PrankRule } from '../lib/prank/model'
import {
  loadOverlaySettings,
  saveOverlaySettings,
  type OverlayRuleStyle,
  type OverlaySettings,
} from '../lib/prank/overlaySettings'

const props = defineProps<{
  rules: PrankRule[]
  giftOptions?: { name: string; icon?: string }[]
}>()

const emit = defineEmits<{
  hint: [string]
  changed: [OverlaySettings]
}>()

const form = reactive<OverlaySettings>(loadOverlaySettings())
const status = ref<{ running: boolean; url: string; port: number; clients: number }>({
  running: false,
  url: '',
  port: form.port,
  clients: 0,
})
const busy = ref(false)

const styleByRule = computed(() => {
  const map = new Map(form.ruleStyles.map((s) => [s.ruleId, s]))
  const giftIcon = new Map((props.giftOptions || []).map((g) => [g.name, g.icon || '']))
  return props.rules.map((r) => {
    const hit = map.get(r.id)
    const custom = hit?.iconDataUrl || ''
    const gName = r.trigger?.kind === 'gift' ? String(r.trigger.giftName || '').trim() : ''
    const fallback = gName ? giftIcon.get(gName) || '' : ''
    return {
      ruleId: r.id,
      name: r.name,
      enabled: r.enabled !== false,
      visible: hit ? hit.visible !== false : true,
      label: hit?.label || '',
      iconDataUrl: custom || fallback,
      hasCustomIcon: !!custom,
      countOffset: hit?.countOffset || 0,
    }
  })
})

function upsertStyle(ruleId: string, patch: Partial<OverlayRuleStyle>) {
  const list = [...form.ruleStyles]
  const i = list.findIndex((x) => x.ruleId === ruleId)
  const base: OverlayRuleStyle =
    i >= 0
      ? { ...list[i] }
      : { ruleId, visible: true, label: '', iconDataUrl: '', countOffset: 0 }
  const next = { ...base, ...patch, ruleId }
  if (i >= 0) list[i] = next
  else list.push(next)
  form.ruleStyles = list
  persist(false)
}

function persist(notify = true) {
  saveOverlaySettings({
    ...form,
    ruleStyles: form.ruleStyles.map((s) => ({ ...s })),
  })
  emit('changed', loadOverlaySettings())
  if (notify) emit('hint', 'OBS 图层配置已保存')
}

async function refreshStatus() {
  const api = window.liveAssistant
  if (!api?.overlayStatus) return
  status.value = await api.overlayStatus()
}

/** 开关：开=启用并启动服务；关=停止 */
async function onToggleService(on: boolean) {
  form.enabled = on
  const api = window.liveAssistant
  if (!api?.overlayStart) {
    persist()
    emit('hint', '请使用桌面客户端配置 OBS 图层')
    return
  }
  busy.value = true
  try {
    persist(false)
    if (!on) {
      await api.overlayStop?.()
      await refreshStatus()
      emit('hint', '已关闭叠层服务')
      return
    }
    const res = await api.overlayStart(form.port)
    await refreshStatus()
    if (!res?.ok) {
      form.enabled = false
      persist(false)
      emit('hint', res?.error || '叠层服务启动失败')
      return
    }
    emit('changed', loadOverlaySettings())
    emit('hint', `叠层已启动：${res.url}`)
  } finally {
    busy.value = false
  }
}

async function onPortChange() {
  persist(false)
  if (form.enabled) await onToggleService(true)
}

async function copyUrl() {
  const url = status.value.url || `http://127.0.0.1:${form.port}/`
  try {
    await navigator.clipboard.writeText(url)
    emit('hint', `已复制：${url}`)
  } catch {
    emit('hint', url)
  }
}

async function pickIcon(ruleId: string) {
  const api = window.liveAssistant
  if (!api?.openFile || !api.mediaAsDataUrl) {
    emit('hint', '请使用桌面端选择图标')
    return
  }
  const path = await api.openFile({
    title: '选择图标',
    filters: [
      { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] },
      { name: '全部', extensions: ['*'] },
    ],
  })
  if (!path) return
  try {
    const dataUrl = await api.mediaAsDataUrl(path)
    upsertStyle(ruleId, { iconDataUrl: dataUrl })
  } catch (e) {
    emit('hint', e instanceof Error ? e.message : '读取图标失败')
  }
}

function clearIcon(ruleId: string) {
  upsertStyle(ruleId, { iconDataUrl: '' })
}

onMounted(() => {
  void refreshStatus()
  if (form.enabled) void onToggleService(true)
})
</script>

<template>
  <div class="obs-panel">
    <fieldset class="box">
      <legend>OBS 浏览器源</legend>
      <p class="tip">
        OBS 添加「浏览器」源，URL 用下面地址；背景透明。关掉开关即停服务。
      </p>
      <div class="svc-row">
        <label class="switch" :class="{ on: form.enabled, busy }" title="启停本地叠层服务">
          <input
            type="checkbox"
            :checked="form.enabled"
            :disabled="busy"
            @change="onToggleService(($event.target as HTMLInputElement).checked)"
          />
          <span class="track"><i /></span>
          <em>{{ form.enabled ? (status.running ? '服务已开' : '启动中…') : '服务关闭' }}</em>
        </label>
        <label class="port">
          <span>端口</span>
          <input
            v-model.number="form.port"
            type="number"
            min="1024"
            max="65535"
            @change="onPortChange"
          />
        </label>
        <span class="svc-status">
          {{ status.running ? `运行中 · ${status.clients} 连接` : '未启动' }}
        </span>
      </div>
      <div class="url-row">
        <input :value="status.url || `http://127.0.0.1:${form.port}/`" readonly />
        <button type="button" class="ghost" @click="copyUrl">复制</button>
      </div>
    </fieldset>

    <fieldset class="box compact">
      <legend>外观</legend>
      <div class="grid-appear">
        <label>
          <span>标题</span>
          <input v-model="form.title" @change="persist(false)" />
        </label>
        <label class="color-lab">
          <span>强调色</span>
          <input v-model="form.accentColor" type="color" @change="persist(false)" />
        </label>
        <label>
          <span>面板宽度</span>
          <input
            v-model.number="form.panelWidth"
            type="number"
            min="160"
            max="900"
            @change="persist(false)"
          />
        </label>
        <label>
          <span>图标大小</span>
          <input
            v-model.number="form.iconSize"
            type="number"
            min="12"
            max="96"
            @change="persist(false)"
          />
        </label>
        <label>
          <span>文字大小</span>
          <input
            v-model.number="form.fontSize"
            type="number"
            min="10"
            max="48"
            @change="persist(false)"
          />
        </label>
        <label>
          <span>数量字号</span>
          <input
            v-model.number="form.countFontSize"
            type="number"
            min="10"
            max="64"
            @change="persist(false)"
          />
        </label>
        <label>
          <span>行间距</span>
          <input v-model.number="form.gap" type="number" min="0" max="40" @change="persist(false)" />
        </label>
        <label>
          <span>最多条数(0=全)</span>
          <input
            v-model.number="form.maxItems"
            type="number"
            min="0"
            max="50"
            @change="persist(false)"
          />
        </label>
        <label>
          <span>背景不透明度</span>
          <input
            v-model.number="form.bgOpacity"
            type="number"
            min="0"
            max="1"
            step="0.05"
            @change="persist(false)"
          />
        </label>
      </div>
      <div class="checks">
        <label class="check">
          <input v-model="form.showTitle" type="checkbox" @change="persist(false)" />
          显示标题
        </label>
        <label class="check">
          <input v-model="form.showTotal" type="checkbox" @change="persist(false)" />
          显示总次数
        </label>
        <label class="check">
          <input v-model="form.showZero" type="checkbox" @change="persist(false)" />
          显示 0 次玩法
        </label>
      </div>
    </fieldset>

    <fieldset class="box compact">
      <legend>各玩法图标 / 文案 / 数量修正</legend>
      <p class="tip">显示数 = 本场累计次数 + 修正值（重连/重启会保留，点「清空列表」才归零）。</p>
      <div v-if="!styleByRule.length" class="empty">暂无玩法，先去「玩法列表」添加</div>
      <div v-else class="rule-grid">
        <div
          v-for="row in styleByRule"
          :key="row.ruleId"
          class="rule-card"
          :class="{ dim: !row.enabled }"
        >
          <div class="rule-head">
            <label class="check">
              <input
                type="checkbox"
                :checked="row.visible"
                :disabled="!row.enabled"
                @change="
                  upsertStyle(row.ruleId, {
                    visible: ($event.target as HTMLInputElement).checked,
                  })
                "
              />
              展示
            </label>
            <strong :title="row.name">{{ row.name }}</strong>
            <em v-if="!row.enabled">未启用</em>
          </div>
          <div class="rule-line">
            <div class="ico-box">
              <img v-if="row.iconDataUrl" :src="row.iconDataUrl" alt="" />
              <span v-else>🎯</span>
            </div>
            <input
              class="name-in"
              type="text"
              :value="row.label"
              placeholder="显示名称（默认玩法名）"
              @change="
                upsertStyle(row.ruleId, {
                  label: ($event.target as HTMLInputElement).value,
                })
              "
            />
            <input
              class="off-in"
              type="number"
              step="1"
              title="数量修正"
              :value="row.countOffset"
              @change="
                upsertStyle(row.ruleId, {
                  countOffset: Number(($event.target as HTMLInputElement).value) || 0,
                })
              "
            />
            <button type="button" class="ghost" @click="pickIcon(row.ruleId)">图标</button>
            <button
              type="button"
              class="ghost"
              :disabled="!row.hasCustomIcon"
              @click="clearIcon(row.ruleId)"
            >
              清
            </button>
          </div>
        </div>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.obs-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 14px 18px;
  overflow: auto;
  min-height: 0;
}

.box {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.box.compact {
  gap: 6px;
}

.box legend {
  padding: 0 6px;
  color: var(--muted);
  font-size: 12px;
}

.tip {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.4;
}

.svc-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
.switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
.switch .track {
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid var(--line);
  position: relative;
  transition: 0.15s ease;
  flex-shrink: 0;
}
.switch .track i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #cfc7bc;
  transition: 0.15s ease;
}
.switch.on .track {
  background: rgba(255, 138, 61, 0.55);
  border-color: rgba(255, 180, 90, 0.7);
}
.switch.on .track i {
  left: 20px;
  background: #fff;
}
.switch.busy {
  opacity: 0.6;
  pointer-events: none;
}
.switch em {
  font-style: normal;
  font-size: 13px;
  color: var(--text);
  font-weight: 600;
}

.port {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.port input {
  width: 88px !important;
  min-width: 88px !important;
}

.svc-status {
  font-size: 12px;
  color: var(--muted);
  margin-left: auto;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.grid-appear {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px 10px;
}

label {
  display: grid;
  gap: 2px;
  font-size: 11px;
  color: var(--muted);
  min-width: 0;
}

.color-lab input[type='color'] {
  height: 28px;
  width: 100%;
}

input[type='text'],
input[type='number'],
input:not([type]) {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 6px;
  padding: 5px 8px;
  outline: none;
  font-size: 13px;
}

input[type='color'] {
  height: 28px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  padding: 1px;
}

.url-row {
  display: flex;
  gap: 8px;
}
.url-row input {
  flex: 1;
  min-width: 0;
}

.ghost {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  white-space: nowrap;
  font-size: 12px;
  flex-shrink: 0;
  line-height: 1.2;
}
.ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.rule-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.rule-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.rule-card.dim {
  opacity: 0.55;
}
.rule-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.rule-head .check {
  flex-shrink: 0;
}
.rule-head strong {
  color: var(--text);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.rule-head em {
  color: var(--muted);
  font-size: 11px;
  font-style: normal;
  flex-shrink: 0;
}

/* 一行：图标 | 名称 | 修正 | 按钮 */
.rule-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.ico-box {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px dashed rgba(255, 138, 61, 0.4);
  background: rgba(255, 138, 61, 0.08);
  display: grid;
  place-items: center;
  overflow: hidden;
  flex-shrink: 0;
  font-size: 14px;
}
.ico-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.name-in {
  flex: 1 1 auto;
  min-width: 0 !important;
  width: auto !important;
}
.off-in {
  flex: 0 0 56px;
  width: 56px !important;
  min-width: 56px !important;
  max-width: 56px !important;
  padding-left: 4px !important;
  padding-right: 4px !important;
  text-align: center;
}
.empty {
  color: var(--muted);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .grid-appear {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .grid-appear,
  .rule-grid {
    grid-template-columns: 1fr;
  }
  .svc-status {
    margin-left: 0;
  }
}
</style>
