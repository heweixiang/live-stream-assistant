/// <reference types="vite/client" />

import type { RuleAction } from './lib/prank/model'
import type { VoiceSampleMeta } from './lib/tts/settings'

declare global {
  interface Window {
    liveAssistant?: {
      notify: (title: string, body: string) => Promise<boolean>
      runAction: (action: RuleAction) => Promise<{ ok: boolean; error?: string; message?: string; kind?: string }>
      listProcesses: () => Promise<{ name: string; title: string; pid: number }[]>
      openFile: (opts?: {
        title?: string
        filters?: { name: string; extensions: string[] }[]
      }) => Promise<string | null>
      mediaAsDataUrl: (filePath: string) => Promise<string>
      ttsSpeak: (opts: {
        provider?: 'melo' | 'system'
        text: string
        meloUrl?: string
        rate?: number
        volume?: number
      }) => Promise<{ ok: boolean; dataUrl?: string; error?: string; bytes?: number }>
      saveVoiceSample: (payload: {
        name?: string
        base64: string
        mime?: string
        durationSec?: number
      }) => Promise<VoiceSampleMeta>
      listVoiceSamples: () => Promise<VoiceSampleMeta[]>
      deleteVoiceSample: (id: string) => Promise<boolean>
      readVoiceSample: (id: string) => Promise<string>
      /** 主进程本机播放 dataUrl */
      playAudioDataUrl: (
        dataUrl: string,
        volume?: number,
      ) => Promise<{ ok: boolean; error?: string }>
      getDataRoot: () => Promise<string>
      loadDiskSettings: () => Promise<Record<string, unknown>>
      saveDiskSettings: (patch: Record<string, unknown>) => Promise<Record<string, unknown>>
      openDataFolder: () => Promise<string>
      exportDataZip: () => Promise<{
        ok: boolean
        canceled?: boolean
        path?: string
        error?: string
      }>
      importDataZip: () => Promise<{
        ok: boolean
        canceled?: boolean
        path?: string
        error?: string
        overwritten?: string[]
        skipped?: string[]
        added?: string[]
      }>
      /** 扫码/手机号登录抖音，返回 Cookie 字符串 */
      douyinLogin: (opts?: { force?: boolean }) => Promise<{
        ok: boolean
        cookie?: string
        canceled?: boolean
        reused?: boolean
        error?: string
      }>
      douyinLogout: () => Promise<boolean>
      douyinAuthStatus: () => Promise<{ cookie: string; loggedIn: boolean }>
      /** 是否管理员权限 */
      isAdmin: () => Promise<boolean>
      /** 以管理员重新启动 */
      relaunchAsAdmin: () => Promise<{ ok: boolean; already?: boolean }>
      overlayStart: (
        port?: number,
      ) => Promise<{ ok: boolean; url?: string; port?: number; error?: string }>
      overlayStop: () => Promise<{ ok: boolean }>
      overlayStatus: () => Promise<{
        running: boolean
        url: string
        port: number
        clients: number
      }>
      overlaySetState: (state: Record<string, unknown>) => Promise<{ ok: boolean }>
      /** 官方礼物列表（现场拉取并缓存到文档目录） */
      fetchDouyinGifts: () => Promise<{
        ok: boolean
        source?: string
        updatedAt?: string
        count?: number
        gifts?: {
          id: number
          name: string
          diamond: number
          icon: string
          panel: boolean
        }[]
        error?: string
      }>
      loadCachedDouyinGifts: () => Promise<{
        ok: boolean
        source?: string
        updatedAt?: string
        count?: number
        gifts?: {
          id: number
          name: string
          diamond: number
          icon: string
          panel: boolean
        }[]
      } | null>
      saveReplaySession: (
        session: unknown,
        maxSessions?: number,
      ) => Promise<{ ok: boolean; id?: string; path?: string; error?: string }>
      listReplaySessions: () => Promise<unknown[]>
      loadReplaySession: (id: string) => Promise<unknown | null>
      deleteReplaySession: (id: string) => Promise<{ ok: boolean; error?: string }>
      platform: string
    }
  }
}

export {}
