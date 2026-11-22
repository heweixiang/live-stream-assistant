import { ref } from 'vue'
import {
  applyGiftDiamond,
  loadGiftDiamondOverrides,
  setGiftDiamondOverride,
  type GiftDiamondOverrides,
} from './giftDiamondOverrides'

/** 跨页面共享的自定义抖钻（设置页改完，规则页立刻生效） */
const overrides = ref<GiftDiamondOverrides>(loadGiftDiamondOverrides())

export function useGiftDiamondOverrides() {
  function reload() {
    overrides.value = loadGiftDiamondOverrides()
  }

  function setDiamond(name: string, diamond: number | null) {
    overrides.value = setGiftDiamondOverride(name, diamond)
  }

  function resolve(name: string, baseDiamond: number) {
    return applyGiftDiamond(name, baseDiamond, overrides.value)
  }

  return { overrides, reload, setDiamond, resolve }
}
