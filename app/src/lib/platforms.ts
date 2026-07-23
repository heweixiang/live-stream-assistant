/** 平台定义：当前仅抖音，后续扩展在此追加。 */

export type PlatformId = 'douyin'

export interface PlatformDef {
  id: PlatformId
  name: string
  needsRoomId: boolean
  roomLabel: string
  roomPlaceholder: string
}

export const platforms: PlatformDef[] = [
  {
    id: 'douyin',
    name: '抖音',
    needsRoomId: true,
    roomLabel: '直播号',
    roomPlaceholder: 'live.douyin.com/后面的数字',
  },
]

export const defaultPlatformId: PlatformId = 'douyin'
