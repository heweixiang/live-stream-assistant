import { reactive, watch } from 'vue'
import { loadPanelFonts, savePanelFonts, type PanelFontKey, type PanelFonts, DEFAULT_PANEL_FONTS } from '../lib/storage'

const fonts = reactive<PanelFonts>({ ...loadPanelFonts() })

watch(
  fonts,
  (v) => savePanelFonts({ ...v }),
  { deep: true },
)

/** 磁盘灌入 localStorage 后，刷新内存中的字号 */
export function reloadPanelFontsFromStorage() {
  Object.assign(fonts, loadPanelFonts())
}

/** 各面板共享的字号设置（自动落盘） */
export function usePanelFonts() {
  function setSize(key: PanelFontKey, px: number) {
    const n = Math.round(Math.min(22, Math.max(10, px)))
    fonts[key] = n
  }

  function resetSize(key: PanelFontKey) {
    fonts[key] = DEFAULT_PANEL_FONTS[key]
  }

  return { fonts, setSize, resetSize, defaults: DEFAULT_PANEL_FONTS }
}
