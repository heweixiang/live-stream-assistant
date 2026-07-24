<script setup lang="ts">
import { watch } from 'vue'
import type { FiredAction } from '../types'

const props = defineProps<{ item: FiredAction | null }>()
const emit = defineEmits<{ done: [] }>()

watch(
  () => props.item,
  (val, _prev, onCleanup) => {
    if (!val) return
    const ms = Math.max(500, Math.min(60000, Number(val.durationMs) || 3200))
    const timer = setTimeout(() => emit('done'), ms)
    onCleanup(() => clearTimeout(timer))
  },
)
</script>

<template>
  <Transition name="toast">
    <div v-if="item" class="toast" role="status">
      <div class="badge">整蛊</div>
      <div>
        <strong>{{ item.ruleName }}</strong>
        <p>{{ item.message }}</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  top: 24px;
  transform: translateX(-50%);
  z-index: 50;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  min-width: 320px;
  max-width: min(560px, 90vw);
  padding: 14px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(255, 138, 61, 0.95), rgba(255, 200, 87, 0.92));
  color: #1a120c;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}

.badge {
  flex: 0 0 auto;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.18);
  font-size: 11px;
  font-weight: 700;
}

strong {
  display: block;
  font-size: 14px;
}

p {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.4;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.28s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -12px);
}
</style>
