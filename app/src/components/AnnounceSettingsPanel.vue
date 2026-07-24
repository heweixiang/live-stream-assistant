<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import {
  ANNOUNCE_KIND_META,
  ANNOUNCE_PLACEHOLDERS,
  exampleVarsFor,
  loadAnnounceSettings,
  renderAnnounceTemplate,
  saveAnnounceSettings,
  stopAnnounceSpeak,
  type AnnounceKind,
  type AnnounceSettings,
} from '../lib/tts/announce'
import { speakText, stopSpeak } from '../lib/tts/speak'
import { clearLikeBucket } from '../lib/likeBatch'

const emit = defineEmits<{
  hint: [string]
}>()

const form = reactive<AnnounceSettings>(loadAnnounceSettings())
const activeKind = ref<AnnounceKind>('like')
const testing = ref(false)

const textRefs = new Map<AnnounceKind, HTMLTextAreaElement>()

function setTextRef(kind: AnnounceKind, el: unknown) {
  if (el instanceof HTMLTextAreaElement) textRefs.set(kind, el)
  else textRefs.delete(kind)
}

const activeRule = computed(() => form.rules.find((r) => r.kind === activeKind.value)!)

const placeholdersForActive = computed(() =>
  ANNOUNCE_PLACEHOLDERS.filter((p) => !p.kinds || p.kinds.includes(activeKind.value)),
)

const previewText = computed(() =>
  renderAnnounceTemplate(activeRule.value.template, exampleVarsFor(activeKind.value)),
)

function persist() {
  form.likeMergeSec = Math.min(60, Math.max(0.5, Number(form.likeMergeSec) || 4))
  saveAnnounceSettings({
    enabled: form.enabled,
    queue: form.queue,
    likeMergeSec: form.likeMergeSec,
    rules: form.rules.map((r) => ({ ...r })),
  })
  emit('hint', '播报设置已保存')
}

function ruleOf(kind: AnnounceKind) {
  return form.rules.find((r) => r.kind === kind)!
}

function metaOf(kind: AnnounceKind) {
  return ANNOUNCE_KIND_META.find((m) => m.kind === kind)!
}

/** 在光标处插入占位符 */
function insertToken(kind: AnnounceKind, token: string) {
  const rule = ruleOf(kind)
  const el = textRefs.get(kind)
  const cur = rule.template || ''
  if (!el) {
    rule.template = cur + token
    persist()
    return
  }
  const start = el.selectionStart ?? cur.length
  const end = el.selectionEnd ?? cur.length
  rule.template = cur.slice(0, start) + token + cur.slice(end)
  persist()
  void nextTick(() => {
    el.focus()
    const pos = start + token.length
    el.setSelectionRange(pos, pos)
  })
}

function onDragStart(ev: DragEvent, token: string) {
  ev.dataTransfer?.setData('text/plain', token)
  ev.dataTransfer!.effectAllowed = 'copy'
}

function onDrop(ev: DragEvent, kind: AnnounceKind) {
  ev.preventDefault()
  const token = ev.dataTransfer?.getData('text/plain') || ''
  if (!token.startsWith('【')) return
  const el = textRefs.get(kind)
  if (el && typeof (el as HTMLTextAreaElement & { selectionStart?: number }).selectionStart === 'number') {
    // 尽量把光标落到鼠标附近：用当前 selection，否则追加
    insertToken(kind, token)
  } else {
    insertToken(kind, token)
  }
}

function onDragOver(ev: DragEvent) {
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}

function resetTemplate(kind: AnnounceKind) {
  ruleOf(kind).template = metaOf(kind).defaultTemplate
  persist()
}

async function testPreview() {
  testing.value = true
  try {
    // 试听时临时视为已开启，避免用户忘开总开关以为坏了
    if (!form.enabled) {
      form.enabled = true
    }
    persist()
    const text = previewText.value
    if (!text) {
      emit('hint', '模板为空')
      return
    }
    await speakText(text, { queue: false })
    emit('hint', `试听：${text}`)
  } catch (e) {
    emit('hint', e instanceof Error ? e.message : '试听失败')
  } finally {
    testing.value = false
  }
}

function onStopSpeak() {
  stopSpeak()
  void stopAnnounceSpeak()
  clearLikeBucket()
  emit('hint', '已停止播报并清空点赞聚合')
}
</script>

<template>
  <div class="announce">
    <fieldset class="box">
      <legend>总开关</legend>
      <div class="checks-row">
        <label class="check">
          <input v-model="form.enabled" type="checkbox" @change="persist" />
          开启语音播报
        </label>
        <label class="check">
          <input v-model="form.queue" type="checkbox" @change="persist" />
          排队播报（最多约 12 条，多了自动丢掉，不会报失败）
        </label>
      </div>
      <div class="acts left">
        <button type="button" class="danger" @click="onStopSpeak">停止播报</button>
      </div>
      <p class="tip">路径：系统设置 → 左侧「语音播报」。点赞聚合秒数请点下面「点赞」页签查看。</p>
    </fieldset>

    <fieldset class="box">
      <legend>播报哪些事件</legend>
      <div class="kind-tabs">
        <button
          v-for="m in ANNOUNCE_KIND_META"
          :key="m.kind"
          type="button"
          class="kind-tab"
          :class="{ on: activeKind === m.kind, off: !ruleOf(m.kind).enabled }"
          @click="activeKind = m.kind"
        >
          <input
            type="checkbox"
            :checked="ruleOf(m.kind).enabled"
            @click.stop
            @change="
              ruleOf(m.kind).enabled = ($event.target as HTMLInputElement).checked;
              persist()
            "
          />
          {{ m.label }}
        </button>
      </div>
    </fieldset>

    <fieldset class="box">
      <legend>如何播报 · {{ metaOf(activeKind).label }}</legend>

      <!-- 点赞：按秒聚合 -->
      <div v-if="activeKind === 'like'" class="agg">
        <label class="agg-sec">
          <span>点赞聚合秒数</span>
          <input
            v-model.number="form.likeMergeSec"
            type="number"
            min="1"
            max="60"
            step="1"
            @change="persist"
          />
        </label>
        <p class="tip strong">
          含义：每 【{{ form.likeMergeSec || 4 }}】 秒把这段时间内的点赞按用户合并数量，再播报一次。
          例：设 5 秒，小明在 5 秒内点了 30 下 → 到点播「感谢小明点了 30 个赞」。
        </p>
      </div>

      <div class="ph-block">
        <div class="ph-head">
          <span>可拖入 / 点击插入的占位符</span>
          <small>拖到下方输入框，或点一下插入光标处</small>
        </div>
        <div class="ph-list">
          <button
            v-for="p in placeholdersForActive"
            :key="p.token"
            type="button"
            class="ph-chip"
            draggable="true"
            :title="`${p.desc} · ${p.token}`"
            @dragstart="onDragStart($event, p.token)"
            @click="insertToken(activeKind, p.token)"
          >
            <strong>{{ p.label }}</strong>
            <code>{{ p.token }}</code>
          </button>
        </div>
      </div>

      <label>
        <span>播报模板</span>
        <textarea
          :ref="(el) => setTextRef(activeKind, el)"
          v-model="activeRule.template"
          rows="3"
          placeholder="例如：感谢【UserName】老板送出的【礼物】"
          @dragover="onDragOver"
          @drop="onDrop($event, activeKind)"
          @change="persist"
        />
      </label>

      <div class="example">
        <div class="ex-label">示例预览</div>
        <p class="ex-vars">
          示例数据：
          <template v-for="(v, k) in exampleVarsFor(activeKind)" :key="k">
            <code>【{{ k }}】</code>={{ v }}
          </template>
        </p>
        <p class="ex-out">→ {{ previewText || '（空）' }}</p>
      </div>

      <div class="acts">
        <button type="button" class="ghost" @click="resetTemplate(activeKind)">恢复默认模板</button>
        <button type="button" class="ghost" @click="persist">保存</button>
        <button type="button" class="primary" :disabled="testing" @click="testPreview">
          {{ testing ? '试听中…' : '试听这条' }}
        </button>
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.announce {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 150%;
  max-width: 150%;
  min-width: 420px;
  box-sizing: border-box;
}

.box {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.box legend {
  padding: 0 6px;
  color: var(--muted);
  font-size: 12px;
}

.checks-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 20px;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
  white-space: nowrap;
  flex-shrink: 0;
}

.tip {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.kind-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.kind-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}

.kind-tab.on {
  border-color: rgba(255, 138, 61, 0.55);
  background: rgba(255, 138, 61, 0.12);
  color: var(--accent-2);
}

.kind-tab.off {
  opacity: 0.55;
}

.ph-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ph-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}

.ph-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ph-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  border: 1px dashed rgba(255, 138, 61, 0.45);
  background: rgba(255, 138, 61, 0.08);
  color: var(--text);
  border-radius: 10px;
  padding: 8px 10px;
  cursor: grab;
  text-align: left;
}

.ph-chip:active {
  cursor: grabbing;
}

.ph-chip strong {
  font-size: 12px;
}

.ph-chip code {
  font-size: 11px;
  color: var(--accent-2);
}

label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

textarea {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 10px 12px;
  outline: none;
  resize: vertical;
  font-size: 14px;
  line-height: 1.5;
}

textarea:focus {
  border-color: rgba(255, 138, 61, 0.55);
}

.example {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.18);
}

.ex-label {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 6px;
}

.ex-vars {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.6;
}

.ex-vars code {
  color: var(--accent-2);
  margin-right: 2px;
}

.ex-out {
  margin: 0;
  font-size: 14px;
  color: var(--text);
  line-height: 1.5;
}

.acts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.acts.left {
  justify-content: flex-start;
}

.agg {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  gap: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 138, 61, 0.35);
  background: rgba(255, 138, 61, 0.08);
}

.agg-sec {
  display: inline-flex !important;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin: 0;
  white-space: nowrap;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 12px;
}

.agg-sec input {
  width: 64px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 6px 8px;
  outline: none;
}

.agg .tip.strong {
  margin: 0;
  flex: 1;
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.45;
}

.tip.strong {
  color: var(--text);
  font-size: 13px;
}

.ghost,
.primary,
.danger {
  border: 0;
  border-radius: 8px;
  padding: 8px 14px;
  cursor: pointer;
}

.ghost {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
}

.primary {
  background: linear-gradient(135deg, var(--accent), #ffb15a);
  color: #1a120c;
  font-weight: 600;
}

.danger {
  background: rgba(255, 90, 90, 0.28);
  color: #ffc9c9;
}
</style>
