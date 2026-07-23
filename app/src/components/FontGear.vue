<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { usePanelFonts } from '../composables/usePanelFonts'
import type { PanelFontKey } from '../lib/storage'

const props = defineProps<{
  panel: PanelFontKey
}>()

const { fonts, setSize, resetSize, defaults } = usePanelFonts()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function onDoc(e: MouseEvent) {
  if (!open.value || !root.value) return
  if (!root.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', onDoc))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDoc))
</script>

<template>
  <div ref="root" class="gear-wrap">
    <button
      type="button"
      class="gear"
      title="字体设置"
      :aria-expanded="open"
      @click.stop="open = !open"
    >
      ⚙
    </button>
    <div v-if="open" class="pop" @click.stop>
      <div class="title">字体大小</div>
      <div class="row">
        <input
          type="range"
          min="10"
          max="20"
          step="1"
          :value="fonts[panel]"
          @input="setSize(panel, Number(($event.target as HTMLInputElement).value))"
        />
        <b>{{ fonts[panel] }}px</b>
      </div>
      <button type="button" class="reset" @click="resetSize(panel)">
        恢复默认（{{ defaults[panel] }}px）
      </button>
    </div>
  </div>
</template>

<style scoped>
.gear-wrap {
  position: relative;
  flex-shrink: 0;
}

.gear {
  border: 0;
  background: transparent;
  color: var(--muted);
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.7;
}

.gear:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
  opacity: 1;
}

.pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  width: 200px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: var(--bg-elevated);
  box-shadow: var(--shadow);
}

.title {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row input {
  flex: 1;
  min-width: 0;
  accent-color: var(--accent);
}

.row b {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  min-width: 2.6em;
  text-align: right;
}

.reset {
  margin-top: 8px;
  width: 100%;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 8px;
  padding: 5px 8px;
  font-size: 11px;
  cursor: pointer;
}

.reset:hover {
  color: var(--text);
}
</style>
