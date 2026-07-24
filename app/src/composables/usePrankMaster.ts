import { ref, watch } from 'vue'
import { loadPrankMasterEnabled, savePrankMasterEnabled } from '../lib/storage'

/** 全局整蛊总开关（默认开） */
const prankMasterEnabled = ref(loadPrankMasterEnabled())

watch(prankMasterEnabled, (v) => savePrankMasterEnabled(v))

export function reloadPrankMasterFromStorage() {
  prankMasterEnabled.value = loadPrankMasterEnabled()
}

export function usePrankMaster() {
  return { prankMasterEnabled }
}
