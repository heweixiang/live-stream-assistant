/**
 * 导出数据包前：把今天的持久化内容全部刷到「文档/直播助手」
 * - settings.json（规则/礼物改价/复盘配置/布局/TTS…）
 * - replays/（已结束场次 + 进行中快照）
 * - douyin-gifts.json、voice-clones、sounds 等本就在目录内
 */
import { flushAllToDisk } from './diskSync'
import { getActiveReplayRecorder } from './replay/activeRecorder'
import { persistReplaySession } from './replay/persist'
import { loadReplayConfig } from './replay/settings'

export async function prepareDataPackageExport(): Promise<void> {
  await flushAllToDisk()

  const rec = getActiveReplayRecorder()
  const snap = rec?.snapshotForExport()
  if (snap) {
    const cfg = loadReplayConfig()
    try {
      await persistReplaySession(snap, cfg.maxSessions)
    } catch (e) {
      console.warn('[export] replay snapshot failed', e)
    }
  }
}
