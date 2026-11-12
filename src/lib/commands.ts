// Rust 命令的类型化封装

import { invoke } from '@tauri-apps/api/core'
import type { AppConfig, BilingualDoc } from '../types'

export const api = {
  loadDoc: (path: string) => invoke<BilingualDoc>('load_document', { path }),

  saveDoc: (path: string, doc: BilingualDoc) => invoke<void>('save_document', { path, doc }),

  writeTextFile: (path: string, content: string, withBom: boolean) =>
    invoke<void>('write_text_file', { path, content, withBom }),

  getConfig: () => invoke<AppConfig>('get_config'),

  saveConfig: (config: AppConfig) => invoke<void>('save_config', { config }),

  setApiKey: (providerId: string, apiKey: string) =>
    invoke<void>('set_api_key', { providerId, apiKey }),

  hasApiKey: (providerId: string) => invoke<boolean>('has_api_key', { providerId }),

  deleteApiKey: (providerId: string) => invoke<void>('delete_api_key', { providerId }),

  confirmClose: () => invoke<void>('confirm_close'),

  cancelClose: () => invoke<void>('cancel_close'),

  pickOpenPath: () => invoke<string | null>('pick_open_path'),

  pickSavePath: (defaultName: string, filterExt: string) =>
    invoke<string | null>('pick_save_path', { defaultName, filterExt }),
}
