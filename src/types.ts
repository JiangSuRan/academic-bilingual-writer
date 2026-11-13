// 数据模型:前端与 Rust 通过 serde(camelCase)共享同一结构

export type Scene =
  | 'abstract'
  | 'introduction'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'figure_legends'

export type PaperProfile =
  | 'nature-omics'
  | 'cell-omics'
  | 'method-tool'
  | 'general-clinical'

export type TranslateQuality = 'fast' | 'high' | 'two-pass'

export type AiMode =
  | 'translate'
  | 'polish'
  | 'compress'
  | 'grammar'
  | 'simplify'
  | 'rework'
  | 'authorInsert'

export type ParaStatus =
  | 'untranslated'
  | 'generated'
  | 'zhModified'
  | 'enEdited'
  | 'translating'
  | 'failed'

export interface Paragraph {
  id: string
  zh: string
  en: string
  /** 最近一次生成当前英文时对应的中文快照,用来判断 stale */
  enSourceZh: string | null
  /** 英文是否被用户手工改过 —— 一旦为 true,后续翻译只写入 enPending */
  enEdited: boolean
  /** 新译/润色缓冲:enEdited 为 true(或手动重译/润色)时放这里,由用户一键接受/丢弃 */
  enPending: string | null
  scene: Scene
  error: string | null
}

export interface BilingualDoc {
  formatVersion: number
  docId: string
  title: string
  createdAt: string
  updatedAt: string
  /** 可选文稿级体裁覆盖;未设置时沿用全局 AppConfig.paperProfile */
  profile?: PaperProfile | null
  paragraphs: Paragraph[]
}

export interface ProviderConfig {
  id: string
  name: string
  baseUrl: string
  model: string
  temperature: number
}

export interface RecentDoc {
  path: string
  title: string
  openedAt: string
}

export interface AppConfig {
  version: number
  providers: ProviderConfig[]
  activeProviderId: string | null
  /** 可选：专门负责润色 / 精缩 / 回炉重修的模型 ID（未设则复用 activeProviderId） */
  polishProviderId: string | null
  theme: 'light' | 'dark'
  zhFontSize: number
  enFontSize: number
  splitRatio: number
  autoTranslate: boolean
  autoDelayMs: number
  defaultScene: Scene
  paperProfile: PaperProfile
  translateQuality: TranslateQuality
  showAuthorSlots: boolean
  glossaryText: string
  customPrompt: string
  recentDocs: RecentDoc[]
  lastOpenedPath: string | null
}
