<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  modelValue?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
}>()

const recording = ref(false)
const display = ref((props.modelValue || '').trim())

watch(
  () => props.modelValue,
  (v) => {
    if (!recording.value) display.value = (v || '').trim()
  },
)

function normalizeKey(e: KeyboardEvent): string | null {
  const k = e.key
  if (!k) return null
  // 单独修饰键不落盘，等真正按键
  if (k === 'Control' || k === 'Alt' || k === 'Shift' || k === 'Meta') return null

  const map: Record<string, string> = {
    ' ': 'space',
    Escape: 'esc',
    Enter: 'enter',
    Tab: 'tab',
    Backspace: 'backspace',
    Delete: 'delete',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Home: 'home',
    End: 'end',
    PageUp: 'pageup',
    PageDown: 'pagedown',
    Insert: 'insert',
  }
  if (map[k]) return map[k]
  if (/^F\d{1,2}$/i.test(k)) return k.toLowerCase()
  if (k.length === 1) return k.toLowerCase()
  // 其它如 CapsLock
  return k.toLowerCase().replace(/\s+/g, '')
}

function buildHotkey(e: KeyboardEvent): string {
  const main = normalizeKey(e)
  if (!main) return ''
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(main)
  return parts.join('+')
}

function onKeyDown(e: KeyboardEvent) {
  if (!recording.value) return
  e.preventDefault()
  e.stopPropagation()

  // Esc：取消录制，不清空已有值
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    stopRecord(false)
    return
  }
  // Backspace：清空
  if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
    display.value = ''
    emit('update:modelValue', '')
    return
  }

  const hotkey = buildHotkey(e)
  if (!hotkey) return
  display.value = hotkey
  emit('update:modelValue', hotkey)
  stopRecord(true)
}

function startRecord() {
  recording.value = true
  display.value = '请按下快捷键…'
  window.addEventListener('keydown', onKeyDown, true)
}

function stopRecord(keepText: boolean) {
  recording.value = false
  window.removeEventListener('keydown', onKeyDown, true)
  const current = (display.value || '').trim()
  const fromProp = String(props.modelValue ?? '').trim()
  if (!keepText) {
    display.value = fromProp
    return
  }
  if (!current || current === '请按下快捷键…') {
    display.value = fromProp
  }
}

function onBoxClick() {
  if (recording.value) return
  startRecord()
}

function clear() {
  display.value = ''
  emit('update:modelValue', '')
  if (recording.value) stopRecord(true)
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown, true)
})
</script>

<template>
  <div class="hotkey" :class="{ on: recording }">
    <button type="button" class="box" @click="onBoxClick">
      <span v-if="display" class="val">{{ display }}</span>
      <span v-else class="ph">点击此处，然后按下要模拟的键（如 Ctrl+C）</span>
    </button>
    <button v-if="recording" type="button" class="mini" @click="stopRecord(false)">取消</button>
    <button v-else-if="modelValue" type="button" class="mini" @click="clear">清除</button>
    <button v-else type="button" class="mini" @click="startRecord">录入</button>
  </div>
  <p class="tip">点输入框 → 按下组合键自动录入；Esc 取消，Backspace 清空。</p>
</template>

<style scoped>
.hotkey {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.box {
  flex: 1;
  min-height: 38px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 12px;
  text-align: left;
  cursor: pointer;
}

.hotkey.on .box {
  border-color: rgba(255, 138, 61, 0.7);
  background: rgba(255, 138, 61, 0.1);
  box-shadow: 0 0 0 1px rgba(255, 138, 61, 0.25);
}

.val {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--accent-2);
}

.ph {
  font-size: 12px;
  color: var(--muted);
}

.mini {
  border: 0;
  border-radius: 8px;
  padding: 0 12px;
  background: rgba(255, 138, 61, 0.2);
  color: var(--accent-2);
  white-space: nowrap;
  min-height: 38px;
  cursor: pointer;
}

.tip {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
