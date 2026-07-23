<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type DarkSelectOption = { value: string; label: string }

const props = defineProps<{
  modelValue: string
  options: DarkSelectOption[]
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [string]
  change: []
}>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const currentLabel = computed(() => {
  const hit = props.options.find((o) => o.value === props.modelValue)
  return hit?.label || props.placeholder || '请选择'
})

function placeMenu() {
  const el = root.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const maxH = 240
  const spaceBelow = window.innerHeight - r.bottom - 8
  const openUp = spaceBelow < 120 && r.top > spaceBelow
  menuStyle.value = {
    position: 'fixed',
    left: `${Math.max(8, r.left)}px`,
    width: `${Math.max(120, r.width)}px`,
    zIndex: '10050',
    maxHeight: `${Math.min(maxH, Math.max(80, openUp ? r.top - 8 : spaceBelow))}px`,
    ...(openUp
      ? { bottom: `${window.innerHeight - r.top + 4}px`, top: 'auto' }
      : { top: `${r.bottom + 4}px`, bottom: 'auto' }),
  }
}

async function toggle(e?: Event) {
  e?.stopPropagation()
  open.value = !open.value
  if (open.value) {
    await nextTick()
    placeMenu()
  }
}

function pick(v: string, e?: Event) {
  e?.stopPropagation()
  emit('update:modelValue', v)
  emit('change')
  open.value = false
}

function onDoc(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (root.value?.contains(t)) return
  if (menuEl.value?.contains(t)) return
  open.value = false
}

function onScrollOrResize() {
  if (open.value) placeMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onDoc, true)
  window.addEventListener('resize', onScrollOrResize)
  window.addEventListener('scroll', onScrollOrResize, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDoc, true)
  window.removeEventListener('resize', onScrollOrResize)
  window.removeEventListener('scroll', onScrollOrResize, true)
})

watch(
  () => props.modelValue,
  () => {
    /* keep open state */
  },
)
</script>

<template>
  <div ref="root" class="dark-select" :class="{ open }" @mousedown.stop>
    <button type="button" class="trigger" @click="toggle">
      <span>{{ currentLabel }}</span>
      <i class="caret" />
    </button>
    <Teleport to="body">
      <ul
        v-if="open"
        ref="menuEl"
        class="menu-portal"
        role="listbox"
        :style="menuStyle"
        @mousedown.stop
      >
        <li
          v-for="o in options"
          :key="o.value"
          role="option"
          :class="{ on: o.value === modelValue }"
          @click="pick(o.value, $event)"
        >
          {{ o.label }}
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.dark-select {
  position: relative;
  width: 100%;
}

.trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 10px;
  text-align: left;
  cursor: pointer;
  font-size: 13px;
}

.trigger:hover {
  border-color: rgba(255, 138, 61, 0.45);
}

.caret {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--muted);
  flex-shrink: 0;
}

.open .caret {
  transform: rotate(180deg);
}
</style>

<style>
/* 挂到 body，避免被弹窗 overflow 裁切 */
.menu-portal {
  margin: 0;
  padding: 6px;
  list-style: none;
  overflow: auto;
  background: #1c1814;
  border: 1px solid rgba(255, 214, 170, 0.12);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
}

.menu-portal li {
  padding: 8px 10px;
  border-radius: 6px;
  color: #f6ebe0;
  font-size: 13px;
  cursor: pointer;
}

.menu-portal li:hover {
  background: rgba(255, 138, 61, 0.14);
}

.menu-portal li.on {
  background: rgba(255, 138, 61, 0.22);
  color: #ffc857;
}
</style>
