<script setup lang="ts">
import { computed, reactive, ref, toRaw, watch } from 'vue'
import DarkSelect from './DarkSelect.vue'
import HotkeyCapture from './HotkeyCapture.vue'
import {
  ACTION_CATEGORIES,
  actionSummary,
  type ActionCategory,
  type MouseOp,
  type OtherOp,
  type RuleAction,
  type SoundMode,
} from '../lib/prank/model'

const props = defineProps<{
  modelValue: boolean
  action: RuleAction | null
}>()

const emit = defineEmits<{
  'update:modelValue': [boolean]
  save: [RuleAction]
}>()

/** 避免 structuredClone(响应式 Proxy) 在 Chromium 直接抛错导致弹窗打不开 */
function cloneAction(src: RuleAction): RuleAction {
  return JSON.parse(JSON.stringify(toRaw(src))) as RuleAction
}

const draft = reactive<RuleAction>({
  id: '',
  category: 'keyboard',
  delayStartSec: 0,
  delayEndSec: 0,
})

watch(
  () => [props.modelValue, props.action] as const,
  ([open, act]) => {
    if (open && act) {
      try {
        Object.assign(draft, cloneAction(act))
      } catch (e) {
        console.warn('[ActionEditor] clone failed', e)
        Object.assign(draft, { ...toRaw(act) })
      }
      if (draft.category === 'other' && draft.otherOp === 'toast' && !(Number(draft.toastCloseSec) > 0)) {
        draft.toastCloseSec = 3
      }
      if (
        open &&
        draft.category === 'other' &&
        (draft.otherOp === 'close_process' || draft.otherOp === 'minimize_process')
      ) {
        void refreshProcs()
      }
    }
  },
  { immediate: true },
)

const readyCats = computed(() => ACTION_CATEGORIES.filter((c) => c.ready))
const soonCats = computed(() => ACTION_CATEGORIES.filter((c) => !c.ready))

const readyHint = computed(() => {
  const meta = ACTION_CATEGORIES.find((c) => c.value === draft.category)
  return meta && !meta.ready ? '该类效果尚在规划，保存后触发时会提示跳过' : ''
})

const soundMode = computed<SoundMode>({
  get: () => draft.soundMode || (draft.ttsText && !draft.mediaPath ? 'tts' : 'file'),
  set: (v) => {
    draft.soundMode = v
  },
})

const mouseOpModel = computed({
  get: () => (draft.mouseOp || 'click_left') as string,
  set: (v: string) => {
    draft.mouseOp = v as MouseOp
  },
})

function setCategory(cat: ActionCategory) {
  draft.category = cat
  if (cat === 'other' && !draft.otherOp) draft.otherOp = 'toast'
  if (cat === 'mouse') {
    if (!draft.mouseOp) draft.mouseOp = 'click_left'
    if (draft.mouseX == null || Number.isNaN(Number(draft.mouseX))) draft.mouseX = 0
    if (draft.mouseY == null || Number.isNaN(Number(draft.mouseY))) draft.mouseY = 0
    if (draft.mouseX2 == null || Number.isNaN(Number(draft.mouseX2))) draft.mouseX2 = 400
    if (draft.mouseY2 == null || Number.isNaN(Number(draft.mouseY2))) draft.mouseY2 = 300
    if (draft.mouseDurationSec == null || Number.isNaN(Number(draft.mouseDurationSec))) draft.mouseDurationSec = 2
    if (draft.mouseSpinTurns == null || Number.isNaN(Number(draft.mouseSpinTurns))) draft.mouseSpinTurns = 4
    if (draft.scrollDelta == null || Number.isNaN(Number(draft.scrollDelta))) draft.scrollDelta = -120
  }
  if (cat === 'sound' && !draft.soundMode) draft.soundMode = 'file'
}

async function pickMedia() {
  const api = window.liveAssistant
  if (!api?.openFile) return
  const path = await api.openFile({
    title: '选择音效文件',
    filters: [
      { name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] },
      { name: '全部', extensions: ['*'] },
    ],
  })
  if (path) {
    draft.mediaPath = path
    draft.soundMode = 'file'
  }
}

async function previewSound() {
  if (soundMode.value === 'tts') {
    await testRun()
    return
  }
  if (!draft.mediaPath) return
  try {
    const api = window.liveAssistant
    const url = api?.mediaAsDataUrl
      ? await api.mediaAsDataUrl(draft.mediaPath)
      : `file:///${draft.mediaPath.replace(/\\/g, '/')}`
    const audio = new Audio(url)
    await audio.play()
  } catch {
    // ignore
  }
}

async function testRun() {
  const api = window.liveAssistant
  const { testAction } = await import('../lib/prank/actionRunner')
  try {
    await testAction(cloneAction(draft), {
      dryToast: (m) => {
        void api?.notify?.('测试', m)
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    void api?.notify?.('测试失败', msg)
  }
}

function onConfirm() {
  emit('save', cloneAction(draft))
  emit('update:modelValue', false)
}

function onCancel() {
  emit('update:modelValue', false)
}

const otherOps: { value: OtherOp; label: string; desc: string }[] = [
  { value: 'toast', label: '弹窗提示', desc: '应用内提示' },
  { value: 'notify', label: '系统通知', desc: 'Windows 通知' },
  { value: 'close_process', label: '关闭某程序', desc: '按进程名强制结束' },
  { value: 'minimize_process', label: '最小化程序', desc: '按进程名最小化窗口' },
  { value: 'show_desktop', label: '返回桌面', desc: '显示桌面' },
  { value: 'shutdown', label: '关机', desc: '5 秒后关机' },
  { value: 'restart', label: '重启', desc: '5 秒后重启' },
  { value: 'stop_stream', label: '自动下播', desc: '待接入' },
]

type ProcItem = { name: string; title: string; pid: number }
const runningProcs = ref<ProcItem[]>([])
const loadingProcs = ref(false)

async function refreshProcs() {
  const api = window.liveAssistant
  if (!api?.listProcesses) return
  loadingProcs.value = true
  try {
    runningProcs.value = (await api.listProcesses()) || []
  } catch {
    runningProcs.value = []
  } finally {
    loadingProcs.value = false
  }
}

function pickProc(name: string) {
  draft.processName = name
}

function selectOtherOp(op: OtherOp) {
  draft.otherOp = op
  if (op === 'toast' && !(Number(draft.toastCloseSec) > 0)) {
    draft.toastCloseSec = 3
  }
  if (op === 'close_process' || op === 'minimize_process') {
    void refreshProcs()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="mask" @click.self="onCancel">
      <div class="dialog" role="dialog" aria-label="行为编辑">
        <header>
          <strong>添加 / 编辑效果</strong>
          <button type="button" class="x" @click="onCancel">×</button>
        </header>

        <section class="block">
          <div class="block-head">
            <span>效果类型</span>
            <small>点选一类后填写参数</small>
          </div>
          <div class="cat-grid">
            <button
              v-for="c in readyCats"
              :key="c.value"
              type="button"
              class="cat-card"
              :class="{ on: draft.category === c.value }"
              @click="setCategory(c.value)"
            >
              <strong>{{ c.label }}</strong>
              <span>{{ c.desc }}</span>
            </button>
          </div>
          <div v-if="soonCats.length" class="cat-soon">
            <span class="soon-label">后续：</span>
            <button
              v-for="c in soonCats"
              :key="c.value"
              type="button"
              class="cat-chip"
              :class="{ on: draft.category === c.value }"
              @click="setCategory(c.value)"
            >
              {{ c.label }}
            </button>
          </div>
          <p v-if="readyHint" class="hint">{{ readyHint }}</p>
        </section>

        <!-- 键盘 -->
        <section v-if="draft.category === 'keyboard'" class="block fields">
          <label>
            <span>模拟按键</span>
            <HotkeyCapture
              :model-value="draft.keys || ''"
              @update:model-value="(v) => (draft.keys = v)"
            />
          </label>
          <div class="row3">
            <label>
              <span>持续时长(秒)</span>
              <input v-model.number="draft.keyHoldSec" type="number" min="0" step="0.05" />
            </label>
            <label>
              <span>执行次数</span>
              <input v-model.number="draft.keyRepeat" type="number" min="1" step="1" />
            </label>
            <label>
              <span>间隔(秒)</span>
              <input v-model.number="draft.keyIntervalSec" type="number" min="0" step="0.05" />
            </label>
          </div>
        </section>

        <!-- 鼠标 -->
        <section v-else-if="draft.category === 'mouse'" class="block fields">
          <label>
            <span>动作</span>
            <DarkSelect
              v-model="mouseOpModel"
              :options="[
                { value: 'click_left', label: '左键单击' },
                { value: 'click_right', label: '右键单击' },
                { value: 'click_middle', label: '中键单击' },
                { value: 'move', label: '移动到指定位置' },
                { value: 'dizzy', label: '天旋地转（螺旋移动）' },
                { value: 'scroll', label: '滚轮' },
              ]"
            />
          </label>

          <template v-if="draft.mouseOp === 'scroll'">
            <label>
              <span>滚轮增量（负=向下，正=向上，常用 ±120）</span>
              <input v-model.number="draft.scrollDelta" type="number" step="120" />
            </label>
            <p class="hint">滚轮不需要坐标；若要先移到某处再滚，可另加一条「移动」效果。</p>
          </template>

          <template v-else-if="draft.mouseOp === 'dizzy'">
            <div class="row2">
              <label>
                <span>起点 X</span>
                <input v-model.number="draft.mouseX" type="number" step="1" />
              </label>
              <label>
                <span>起点 Y</span>
                <input v-model.number="draft.mouseY" type="number" step="1" />
              </label>
            </div>
            <div class="row2">
              <label>
                <span>终点 X</span>
                <input v-model.number="draft.mouseX2" type="number" step="1" />
              </label>
              <label>
                <span>终点 Y</span>
                <input v-model.number="draft.mouseY2" type="number" step="1" />
              </label>
            </div>
            <div class="row2">
              <label>
                <span>耗时（秒）</span>
                <input v-model.number="draft.mouseDurationSec" type="number" min="0.3" max="30" step="0.1" />
              </label>
              <label>
                <span>螺旋圈数</span>
                <input v-model.number="draft.mouseSpinTurns" type="number" min="1" max="20" step="1" />
              </label>
            </div>
            <p class="hint">
              光标会从起点螺旋晃到终点。起点填 0,0 表示从当前位置开始。圈数越大越晕。
            </p>
          </template>

          <template v-else>
            <div class="row2">
              <label>
                <span>屏幕 X（左）</span>
                <input v-model.number="draft.mouseX" type="number" step="1" />
              </label>
              <label>
                <span>屏幕 Y（上）</span>
                <input v-model.number="draft.mouseY" type="number" step="1" />
              </label>
            </div>
            <p class="hint">
              {{
                draft.mouseOp === 'move'
                  ? '移动到该屏幕坐标。'
                  : '在该坐标点击；填 0,0 表示在当前位置点击。'
              }}
            </p>
          </template>
        </section>

        <!-- 声音：文件 / TTS -->
        <section v-else-if="draft.category === 'sound'" class="block fields">
          <div class="mode-tabs">
            <button
              type="button"
              class="mode-tab"
              :class="{ on: soundMode === 'file' }"
              @click="soundMode = 'file'"
            >
              本地音频
            </button>
            <button
              type="button"
              class="mode-tab"
              :class="{ on: soundMode === 'tts' }"
              @click="soundMode = 'tts'"
            >
              TTS 朗读
            </button>
          </div>

          <template v-if="soundMode === 'file'">
            <label>
              <span>音频文件（mp3 / wav 等）</span>
              <div class="file-row">
                <input v-model="draft.mediaPath" placeholder="不选则跳过，不影响其它效果" />
                <button type="button" class="mini" @click="pickMedia">选择</button>
                <button type="button" class="mini" @click="previewSound">试听</button>
              </div>
            </label>
          </template>
          <template v-else>
            <p class="hint">
              音色在「系统设置 → TTS 语音」配置。此处只填要读的文案。
            </p>
            <label>
              <span>朗读文本</span>
              <textarea
                v-model="draft.ttsText"
                rows="3"
                placeholder="例如：有人点赞了，主播喝一口水"
              />
            </label>
            <div class="row2">
              <label>
                <span>语速 (0.5~2，可覆盖默认)</span>
                <input v-model.number="draft.ttsRate" type="number" min="0.5" max="2" step="0.1" />
              </label>
              <label>
                <span>音量 (0~3，&gt;1 更响)</span>
                <input v-model.number="draft.ttsVolume" type="number" min="0" max="3" step="0.1" />
              </label>
            </div>
            <button type="button" class="mini wide" @click="previewSound">试听 TTS</button>
          </template>
        </section>

        <!-- 系统操作 -->
        <section v-else-if="draft.category === 'other'" class="block fields">
          <div class="other-grid">
            <button
              v-for="o in otherOps"
              :key="o.value"
              type="button"
              class="other-card"
              :class="{ on: draft.otherOp === o.value }"
              @click="selectOtherOp(o.value)"
            >
              <strong>{{ o.label }}</strong>
              <span>{{ o.desc }}</span>
            </button>
          </div>
          <label v-if="draft.otherOp === 'toast' || draft.otherOp === 'notify'">
            <span>提示文案</span>
            <input v-model="draft.message" />
          </label>
          <label v-if="draft.otherOp === 'toast'">
            <span>关闭时间(秒)</span>
            <input
              v-model.number="draft.toastCloseSec"
              type="number"
              min="0.5"
              max="60"
              step="0.5"
              placeholder="3"
            />
          </label>
          <p v-if="draft.otherOp === 'toast'" class="hint">
            弹窗显示多久后自动关闭，默认 3 秒（0.5～60）
          </p>

          <div
            v-if="draft.otherOp === 'close_process' || draft.otherOp === 'minimize_process'"
            class="proc-panel"
          >
            <label>
              <span>{{ draft.otherOp === 'close_process' ? '要关闭的程序（进程名）' : '要最小化的程序（进程名）' }}</span>
              <div class="file-row">
                <input
                  v-model="draft.processName"
                  placeholder="例如：chrome / notepad / LeagueClient / game.exe"
                />
                <button type="button" class="mini" @click="testRun">测试</button>
              </div>
            </label>
            <p class="hint">
              填任务管理器里的进程名即可，可带或不带 .exe。点下方可选中正在运行的程序。
            </p>
            <div class="proc-bar">
              <button type="button" class="mini" :disabled="loadingProcs" @click="refreshProcs">
                {{ loadingProcs ? '刷新中…' : '刷新进程列表' }}
              </button>
            </div>
            <div v-if="runningProcs.length" class="proc-list">
              <button
                v-for="p in runningProcs"
                :key="`${p.name}-${p.pid}`"
                type="button"
                class="proc-chip"
                :class="{ on: draft.processName === p.name || draft.processName === `${p.name}.exe` }"
                :title="`${p.title || p.name} (PID ${p.pid})`"
                @click="pickProc(p.name)"
              >
                <strong>{{ p.name }}</strong>
                <span>{{ p.title || '无标题' }}</span>
              </button>
            </div>
            <p v-else class="hint">暂无带窗口的进程，可点「刷新进程列表」或手动填写。</p>
          </div>

          <p v-if="draft.otherOp === 'shutdown' || draft.otherOp === 'restart'" class="warn">
            危险操作：触发后约 5 秒执行，可用 shutdown /a 取消。
          </p>
        </section>

        <section v-else class="block">
          <p class="hint">「{{ actionSummary(draft) }}」执行器后续接入，可先保存占位。</p>
        </section>

        <section class="block fields delay">
          <div class="row2">
            <label>
              <span>延迟开始(秒)</span>
              <input v-model.number="draft.delayStartSec" type="number" min="0" step="0.05" />
            </label>
            <label>
              <span>延迟结束(秒)</span>
              <input v-model.number="draft.delayEndSec" type="number" min="0" step="0.05" />
            </label>
          </div>
        </section>

        <footer>
          <button type="button" class="ghost" @click="onCancel">取消</button>
          <button type="button" class="mini" @click="testRun">测试此效果</button>
          <button type="button" class="primary" @click="onConfirm">确定</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.55);
  display: grid;
  place-items: center;
  padding: 20px;
}

.dialog {
  width: min(680px, 100%);
  max-height: min(860px, 92vh);
  overflow-x: hidden;
  overflow-y: auto;
  background: #1c1814;
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  /* 避免内部 absolute 下拉被莫名裁切；DarkSelect 已 Teleport 到 body */
  overscroll-behavior: contain;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}

.x {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 22px;
  line-height: 1;
}

.block {
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 10px;
}

.block-head small {
  opacity: 0.8;
}

.cat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.cat-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  text-align: left;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--text);
  cursor: pointer;
}

.cat-card strong {
  font-size: 14px;
}

.cat-card span {
  font-size: 11px;
  color: var(--muted);
}

.cat-card.on {
  border-color: rgba(255, 138, 61, 0.65);
  background: rgba(255, 138, 61, 0.12);
}

.cat-soon {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.soon-label {
  font-size: 11px;
  color: var(--muted);
}

.cat-chip {
  border: 1px dashed var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  opacity: 0.7;
}

.cat-chip.on {
  opacity: 1;
  color: var(--accent-2);
  border-color: rgba(255, 138, 61, 0.5);
}

.mode-tabs {
  display: flex;
  gap: 8px;
}

.mode-tab {
  flex: 1;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
}

.mode-tab.on {
  color: var(--accent-2);
  border-color: rgba(255, 138, 61, 0.55);
  background: rgba(255, 138, 61, 0.1);
}

.other-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.other-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  padding: 8px 10px;
  color: var(--text);
  cursor: pointer;
}

.other-card strong {
  font-size: 13px;
}

.other-card span {
  font-size: 11px;
  color: var(--muted);
}

.other-card.on {
  border-color: rgba(255, 138, 61, 0.65);
  background: rgba(255, 138, 61, 0.12);
}

.proc-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 138, 61, 0.4);
  border-radius: 10px;
  background: rgba(255, 138, 61, 0.08);
}

.proc-bar {
  display: flex;
  gap: 8px;
}

.proc-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 160px;
  overflow: auto;
}

.proc-chip {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  max-width: 180px;
  text-align: left;
  border: 1px solid var(--line);
  background: rgba(0, 0, 0, 0.25);
  color: var(--text);
  border-radius: 8px;
  padding: 6px 8px;
  cursor: pointer;
}

.proc-chip strong {
  font-size: 12px;
}

.proc-chip span {
  font-size: 10px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

.proc-chip.on {
  border-color: rgba(255, 138, 61, 0.65);
  background: rgba(255, 138, 61, 0.16);
  color: var(--accent-2);
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.fields label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}

.fields input,
.fields select,
.fields textarea {
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 10px;
  outline: none;
  resize: vertical;
}

.row2,
.row3 {
  display: grid;
  gap: 10px;
}

.row2 {
  grid-template-columns: 1fr 1fr;
}

.row3 {
  grid-template-columns: 1fr 1fr 1fr;
}

.file-row {
  display: flex;
  gap: 8px;
}

.file-row input {
  flex: 1;
}

.mini {
  border: 0;
  border-radius: 8px;
  padding: 0 12px;
  background: rgba(255, 138, 61, 0.2);
  color: var(--accent-2);
  white-space: nowrap;
  min-height: 34px;
}

.mini.wide {
  width: fit-content;
  padding: 8px 14px;
}

.hint {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.warn {
  margin: 0;
  color: #ffb4b4;
  font-size: 12px;
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 16px;
}

.ghost {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 8px;
  padding: 8px 16px;
}

.primary {
  border: 0;
  border-radius: 8px;
  padding: 8px 18px;
  background: linear-gradient(135deg, var(--accent), #ffb15a);
  color: #1a120c;
  font-weight: 600;
}
</style>
