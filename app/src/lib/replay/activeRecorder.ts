import type { ReplayRecorder } from './recorder'

/** 供导出数据包等跨组件拿到当前录制器 */
let active: ReplayRecorder | null = null

export function bindReplayRecorder(recorder: ReplayRecorder) {
  active = recorder
}

export function getActiveReplayRecorder() {
  return active
}
