// 数据模型:前端与 Rust 通过 serde(camelCase)共享同一结构

export type Scene = 'abstract' | 'introduction' | 'methods' | 'results' | 'discussion'

export type ParaStatus =
  | 'untranslated'
  | 'generated'
  | 'zhModified'
  | 'enEdited'
  | 'translating'
  | 'failed'

/** 一对中英段落;id 是双栏对应的唯一锚点,插入/删除/移动都不会破坏其它段落的对应关系 */
export interface Paragraph {
  id: string
  zh: string
  en: string
  /** 生成当前英文时的中文快照,用于派生"中文已修改"状态 */
  enSourceZh: string | null
  /** 最近一次 AI 写入之后,英文是否被人工编辑过(人工编辑过的英文 AI 永不自动覆盖) */
  enEdited: boolean
  /** 重译/润色等产生的新结果缓冲,待用户"替换 / 丢弃"确认后才写入 en */
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
  theme: 'light' | 'dark'
  zhFontSize: number
  enFontSize: number
  splitRatio: number
  autoTranslate: boolean
  autoDelayMs: number
  defaultScene: Scene
  glossaryText: string
  customPrompt: string
  recentDocs: RecentDoc[]
  lastOpenedPath: string | null
}
