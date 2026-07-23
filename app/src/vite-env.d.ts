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
        text: string
        key: string
        region: string
        voice?: string
        rate?: number
        volume?: number
        useClone?: boolean
        speakerProfileId?: string
        personalVoiceName?: string
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
      platform: string
    }
  }
}

export {}
