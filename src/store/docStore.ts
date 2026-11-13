// 应用状态仓库:文稿、配置、AI 调度、防覆盖、自动保存
// 设计原则:段落以稳定 id 锚定;英文一经人工编辑,AI 永不自动覆盖;
// 重译结果先进 enPending 缓冲,由用户确认替换。

import { create } from 'zustand'
import { nanoid } from '../lib/nanoid'
import { api } from '../lib/commands'
import { initAiEvents, streamChat, cancelAi, testConnection } from '../lib/ai'
import { buildMessages, type AiMode } from '../lib/prompts'
import { parseGlossaryText, pickGlossary } from '../lib/glossary'
import { sanitizeModelOutput, paraStatus, buildEnglishExport, buildBilingualExport, boundText } from '../lib/paragraphs'
import {
  analyzeParagraphStyle,
  auditEnglishPolish,
  auditZhToEnFidelity,
  buildSectionCoordContext,
  type StyleFlag,
  type ZhEnFidelityIssue,
} from '../lib/polishAudit'
import type { AppConfig, BilingualDoc, PaperProfile, Paragraph, ProviderConfig, Scene } from '../types'

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  providers: [
    { id: 'p-default', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', temperature: 0.3 },
    { id: 'p-deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0.3 },
  ],
  activeProviderId: 'p-default',
  polishProviderId: null,
  theme: 'light',
  zhFontSize: 16,
  enFontSize: 15,
  splitRatio: 0.5,
  autoTranslate: false,
  autoDelayMs: 2000,
  defaultScene: 'results',
  paperProfile: 'nature-omics',
  translateQuality: 'high',
  showAuthorSlots: true,
  glossaryText: '',
  customPrompt: '',
  recentDocs: [],
  lastOpenedPath: null,
}

export const DEFAULT_DOC: () => BilingualDoc = () => ({
  formatVersion: 1,
  docId: nanoid(),
  title: '未命名文稿',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  profile: null,
  paragraphs: [makeParagraph()],
})

export function makeParagraph(scene: Scene = 'results'): Paragraph {
  return {
    id: nanoid(),
    zh: '',
    en: '',
    enSourceZh: null,
    enEdited: false,
    enPending: null,
    scene,
    error: null,
  }
}

interface SaveState {
  dirty: boolean
  saving: boolean
  lastSavedAt: string | null
}

export interface CompressPreviewState {
  scene: Scene
  text: string
  loading: boolean
  error?: string
}

export interface RunExtraOpts {
  authorNote?: string
  reworkFlags?: StyleFlag[]
  fidelityIssues?: ZhEnFidelityIssue[]
}

interface DocState {
  booted: boolean
  doc: BilingualDoc
  filePath: string | null
  save: SaveState
  config: AppConfig
  settingsOpen: boolean
  reviewOpen: boolean
  compressPreview: CompressPreviewState | null
  /** 请求窗口关闭时暂存的动作,由 Rust 端 close 事件触发 */
  translatingIds: Record<string, true>
  failedIds: Record<string, true>
  streamingEn: Record<string, string>
  activeParaId: string | null
  toast: { kind: 'info' | 'error' | 'success'; text: string } | null

  boot(): Promise<void>
  newDoc(): Promise<void>
  openDoc(path: string): Promise<void>
  openDocDialog(): Promise<void>
  saveDoc(): Promise<void>
  setTitle(t: string): void
  setDocProfile(profile: PaperProfile | null): void
  updateZh(id: string, text: string, composing: boolean): void
  updateEn(id: string, text: string): void
  setScene(id: string, scene: Scene): void
  addAfter(id: string | null): string
  remove(id: string): void
  setActive(id: string | null): void

  translate(id: string, opts?: { force?: boolean }): Promise<void>
  translateAllPending(): Promise<void>
  polish(id: string, mode: Exclude<AiMode, 'translate'>, force?: boolean, extra?: RunExtraOpts): Promise<void>
  insertAuthorNote(id: string, text: string, directEnglish?: boolean): Promise<void>
  cancel(id: string): void
  acceptPending(id: string): void
  discardPending(id: string): void

  updateConfig(patch: Partial<AppConfig>): Promise<void>
  saveApiKey(providerId: string, key: string): Promise<void>
  loadApiKeyState(providerId: string): Promise<void>
  apiKeyReady: Record<string, boolean>
  testConn(provider: { providerId: string; baseUrl: string; model: string }): Promise<string>
  toggleTheme(): void

  copyEn(id: string): Promise<void>
  copySelectedEn(): Promise<void>
  copyAllEn(): Promise<void>
  exportEnTxt(): Promise<void>
  exportBilingualTxt(): Promise<void>

  openSettings(open: boolean): void
  openReview(open: boolean): void
  generateSectionCompressPreview(scene: Scene): Promise<void>
  clearSectionCompressPreview(): void
  showToast(kind: 'info' | 'error' | 'success', text: string): void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
const AUTO_SAVE_MS = 1200
/** 自动翻译:仅对「未翻译」段触发;中文修改过的段永远走手动,防止编辑被打断 */
const AUTO_ONLY_UNTRANSLATED = true

function scheduleAutoSave(get: () => DocState, set: (p: Partial<DocState>) => void) {
  set({ save: { ...get().save, dirty: true } })
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void get().saveDoc() }, AUTO_SAVE_MS)
}

function touchDoc(doc: BilingualDoc): BilingualDoc {
  return { ...doc, updatedAt: new Date().toISOString() }
}

export const useStore = create<DocState>((set, get) => ({
  booted: false,
  doc: DEFAULT_DOC(),
  filePath: null,
  save: { dirty: false, saving: false, lastSavedAt: null },
  config: DEFAULT_CONFIG,
  settingsOpen: false,
  reviewOpen: false,
  compressPreview: null,
  translatingIds: {},
  failedIds: {},
  streamingEn: {},
  activeParaId: null,
  toast: null,
  apiKeyReady: {},

  async boot() {
    await initAiEvents()
    let config = DEFAULT_CONFIG
    try {
      const loaded = await api.getConfig()
      config = { ...DEFAULT_CONFIG, ...loaded }
    } catch { /* 首次运行无配置,用默认值 */ }
    if (!config.providers.length) config.providers = DEFAULT_CONFIG.providers
    if (!config.providers.some((p) => p.id === config.activeProviderId)) {
      config.activeProviderId = config.providers[0]?.id ?? null
    }
    if (config.polishProviderId && !config.providers.some((p) => p.id === config.polishProviderId)) {
      config.polishProviderId = null
    }
    set({ config, booted: true })
    document.documentElement.dataset.theme = config.theme

    // 恢复上次打开的文稿;失败则保持新文稿,不阻塞启动
    if (config.lastOpenedPath) {
      try {
        const doc = await api.loadDoc(config.lastOpenedPath)
        set({ doc, filePath: config.lastOpenedPath, save: { dirty: false, saving: false, lastSavedAt: doc.updatedAt } })
      } catch { /* 文件可能已被移动/删除,静默回退 */ }
    }
  },

  async newDoc() {
    if (get().save.dirty) await get().saveDoc()
    set({ doc: DEFAULT_DOC(), filePath: null, translatingIds: {}, failedIds: {}, streamingEn: {}, save: { dirty: false, saving: false, lastSavedAt: null }, activeParaId: null })
  },

  async openDoc(path: string) {
    if (get().save.dirty) await get().saveDoc()
    const doc = await api.loadDoc(path)
    set({
      doc,
      filePath: path,
      translatingIds: {},
      failedIds: {},
      streamingEn: {},
      save: { dirty: false, saving: false, lastSavedAt: doc.updatedAt },
      activeParaId: null,
    })
    await get().updateConfig({ lastOpenedPath: path, recentDocs: pushRecent(get().config.recentDocs, path, doc.title) })
  },

  async openDocDialog() {
    const path = await api.pickOpenPath()
    if (path) await get().openDoc(path)
  },

  async saveDoc() {
    const { doc, filePath } = get()
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    set({ save: { ...get().save, saving: true } })
    try {
      const d = touchDoc(doc)
      let path = filePath
      if (!path) {
        const p = await api.pickSavePath(`${d.title || '未命名文稿'}.abw.json`, 'abw.json')
        if (!p) { set({ save: { ...get().save, saving: false } }); return }
        path = p
      }
      await api.saveDoc(path, d)
      set({
        doc: d,
        filePath: path,
        save: { dirty: false, saving: false, lastSavedAt: d.updatedAt },
      })
      if (get().config.lastOpenedPath !== path || !get().config.recentDocs.some((r) => r.path === path)) {
        await get().updateConfig({ lastOpenedPath: path, recentDocs: pushRecent(get().config.recentDocs, path, d.title) })
      }
    } catch (e) {
      set({ save: { ...get().save, saving: false }, toast: { kind: 'error', text: `保存失败:${String(e)}` } })
    }
  },

  setTitle(t: string) {
    set({ doc: touchDoc({ ...get().doc, title: t }) })
    scheduleAutoSave(get, set)
  },

  setDocProfile(profile: PaperProfile | null) {
    set({ doc: touchDoc({ ...get().doc, profile }) })
    scheduleAutoSave(get, set)
  },

  /** 中文编辑:组合输入期间只更新文本,不触发自动翻译判定 */
  updateZh(id: string, text: string, composing: boolean) {
    const doc = touchDoc({ ...get().doc, paragraphs: get().doc.paragraphs.map((p) => (p.id === id ? { ...p, zh: text } : p)) })
    set({ doc, activeParaId: id })
    if (composing) return
    scheduleAutoSave(get, set)
    const cfg = get().config
    if (!cfg.autoTranslate) return
    const p = doc.paragraphs.find((x) => x.id === id)
    if (!p) return
    const st = paraStatus(p, { translatingIds: get().translatingIds, failedIds: get().failedIds })
    if (AUTO_ONLY_UNTRANSLATED && st === 'untranslated') {
      scheduleAutoTranslate(id, get, set)
    }
  },

  updateEn(id: string, text: string) {
    const doc = touchDoc({
      ...get().doc,
      paragraphs: get().doc.paragraphs.map((p) => {
        if (p.id !== id) return p
        const wasAiText = !p.enEdited && p.en.trim().length > 0
        // 人工改动已生成的英文 → 标记 enEdited,此后 AI 永不自动覆盖该段
        const enEdited = p.enEdited || (wasAiText && text !== p.en)
        return { ...p, en: text, enEdited }
      }),
    })
    set({ doc, activeParaId: id })
    scheduleAutoSave(get, set)
  },

  setScene(id: string, scene: Scene) {
    set({ doc: touchDoc({ ...get().doc, paragraphs: get().doc.paragraphs.map((p) => (p.id === id ? { ...p, scene } : p)) }) })
    scheduleAutoSave(get, set)
  },

  addAfter(id: string | null) {
    const paras = [...get().doc.paragraphs]
    const idx = id ? paras.findIndex((x) => x.id === id) : paras.length - 1
    const baseScene = (idx >= 0 ? paras[idx]?.scene : undefined) ?? get().config.defaultScene ?? 'results'
    const p = makeParagraph(baseScene)
    paras.splice(idx + 1, 0, p)
    set({ doc: touchDoc({ ...get().doc, paragraphs: paras }), activeParaId: p.id })
    scheduleAutoSave(get, set)
    return p.id
  },

  remove(id: string) {
    const paras = get().doc.paragraphs.filter((p) => p.id !== id)
    if (!paras.length) paras.push(makeParagraph())
    const tids = { ...get().translatingIds }
    delete tids[id]
    const fids = { ...get().failedIds }
    delete fids[id]
    const se = { ...get().streamingEn }
    delete se[id]
    set({ doc: touchDoc({ ...get().doc, paragraphs: paras }), translatingIds: tids, failedIds: fids, streamingEn: se })
    scheduleAutoSave(get, set)
  },

  setActive(id: string | null) {
    set({ activeParaId: id })
  },

  async translate(id: string, opts?: { force?: boolean }) {
    await runAi(id, 'translate', get, set, opts?.force === true)
  },

  async translateAllPending() {
    const { doc, config } = get()
    const provider = activeProvider(config)
    if (!provider) { set({ settingsOpen: true, toast: { kind: 'error', text: '请先在设置中配置模型服务' } }); return }
    // 只处理未翻译段;中文已修改/英文已编辑的段必须手动确认,防止批量覆盖
    const targets = doc.paragraphs.filter((p) => paraStatus(p, { translatingIds: get().translatingIds, failedIds: get().failedIds }) === 'untranslated' && p.zh.trim())
    if (!targets.length) { set({ toast: { kind: 'info', text: '没有待翻译的段落(已修改或已编辑的段落请单独重译)' } }); return }
    // 串行执行,避免触发服务商限流
    for (const p of targets) {
      if (!get().doc.paragraphs.some((x) => x.id === p.id)) continue
      await runAi(p.id, 'translate', get, set, false)
    }
  },

  async polish(id: string, mode, force = false, extra) {
    await runAi(id, mode, get, set, force, extra)
  },

  async insertAuthorNote(id: string, text: string, directEnglish = false) {
    const clean = text.trim()
    if (!clean) return
    const para = get().doc.paragraphs.find((p) => p.id === id)
    if (!para || !para.en.trim()) {
      set({ toast: { kind: 'info', text: '请先生成本段英文，再注入作者补充信息' } })
      return
    }
    if (directEnglish) {
      const merged = `${para.en.trimEnd()} ${clean}`
      set({
        doc: touchDoc({
          ...get().doc,
          paragraphs: get().doc.paragraphs.map((p) => (p.id === id ? { ...p, enPending: merged, error: null } : p)),
        }),
        toast: { kind: 'info', text: '已将作者英文补充放入新版本缓冲，请比较后确认' },
      })
      scheduleAutoSave(get, set)
      return
    }
    await runAi(id, 'authorInsert', get, set, false, { authorNote: clean })
  },

  cancel(id: string) {
    canceledIds.add(id)
    const rid = reqIds.get(id)
    if (rid) cancelAi(rid)
    // 直接释放等待点,防止 Rust 侧终态事件缺失导致批量翻译卡住
    const rel = reqCompleters.get(id)
    reqCompleters.delete(id)
    rel?.()
    set({
      translatingIds: omit(get().translatingIds, id),
      streamingEn: omit(get().streamingEn, id),
    })
  },

  acceptPending(id: string) {
    set({
      doc: touchDoc({
        ...get().doc,
        paragraphs: get().doc.paragraphs.map((p) =>
          p.id === id && p.enPending !== null
            ? { ...p, en: p.enPending, enPending: null, enSourceZh: p.zh, enEdited: false, error: null }
            : p,
        ),
      }),
      failedIds: omit(get().failedIds, id),
    })
    scheduleAutoSave(get, set)
  },

  discardPending(id: string) {
    set({
      doc: touchDoc({ ...get().doc, paragraphs: get().doc.paragraphs.map((p) => (p.id === id ? { ...p, enPending: null } : p)) }),
    })
    scheduleAutoSave(get, set)
  },

  async updateConfig(patch) {
    const config = { ...get().config, ...patch }
    set({ config })
    if (patch.theme !== undefined) document.documentElement.dataset.theme = patch.theme
    try { await api.saveConfig(config) } catch (e) { set({ toast: { kind: 'error', text: `配置保存失败:${String(e)}` } }) }
  },

  async saveApiKey(providerId, key) {
    await api.setApiKey(providerId, key)
    set({ apiKeyReady: { ...get().apiKeyReady, [providerId]: key.trim().length > 0 } })
  },

  async loadApiKeyState(providerId) {
    try {
      const has = await api.hasApiKey(providerId)
      set({ apiKeyReady: { ...get().apiKeyReady, [providerId]: has } })
    } catch { /* ignore */ }
  },

  async testConn(provider) {
    return testConnection(provider)
  },

  toggleTheme() {
    const theme = get().config.theme === 'dark' ? 'light' : 'dark'
    void get().updateConfig({ theme })
  },

  async copyEn(id) {
    const p = get().doc.paragraphs.find((x) => x.id === id)
    if (!p || !p.en.trim()) { set({ toast: { kind: 'info', text: '该段落暂无英文内容' } }); return }
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(p.en.trim())
    set({ toast: { kind: 'success', text: '已复制本段英文(纯文本)' } })
  },

  async copySelectedEn() {
    const sel = window.getSelection()?.toString() || ''
    if (!sel.trim()) { set({ toast: { kind: 'info', text: '请先在英文区选中要复制的文本' } }); return }
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(sel)
    set({ toast: { kind: 'success', text: '已复制所选英文(纯文本)' } })
  },

  async copyAllEn() {
    const text = buildEnglishExport(get().doc.paragraphs)
    if (!text) { set({ toast: { kind: 'info', text: '暂无可复制的英文内容' } }); return }
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
    set({ toast: { kind: 'success', text: `已复制全部英文(${get().doc.paragraphs.filter((p) => p.en.trim()).length} 段,纯文本)` } })
  },

  async exportEnTxt() {
    const text = buildEnglishExport(get().doc.paragraphs)
    if (!text) { set({ toast: { kind: 'info', text: '暂无英文内容可导出' } }); return }
    const path = await askSavePath(`${get().doc.title || '文稿'}-英文.txt`)
    if (!path) return
    await api.writeTextFile(path, text, true)
    set({ toast: { kind: 'success', text: '已导出英文 TXT' } })
  },

  async exportBilingualTxt() {
    const text = buildBilingualExport(get().doc.paragraphs)
    const path = await askSavePath(`${get().doc.title || '文稿'}-中英对照.txt`)
    if (!path) return
    await api.writeTextFile(path, text, true)
    set({ toast: { kind: 'success', text: '已导出中英对照 TXT' } })
  },

  openSettings(open) {
    set({ settingsOpen: open })
    if (open) {
      const ap = activeProvider(get().config)
      if (ap) void get().loadApiKeyState(ap.id)
    }
  },

  openReview(open) {
    set({ reviewOpen: open })
  },

  clearSectionCompressPreview() {
    set({ compressPreview: null })
  },

  async generateSectionCompressPreview(scene: Scene) {
    const { doc, config } = get()
    const provider = resolveProvider(config, 'compress', true)
    if (!provider) {
      set({ settingsOpen: true, toast: { kind: 'error', text: '请先在设置中配置 API 服务' } })
      return
    }
    const paras = doc.paragraphs.filter((p) => p.scene === scene && p.en.trim())
    if (!paras.length) {
      set({ toast: { kind: 'info', text: '该章节暂无已生成英文段落' } })
      return
    }
    const combinedEn = paras.map((p) => p.en.trim()).join('\n\n')
    const profile = doc.profile ?? config.paperProfile ?? 'nature-omics'
    const messages = buildMessages({
      mode: 'compress',
      scene,
      profile,
      quality: 'high',
      en: combinedEn,
      customPrompt: config.customPrompt,
    })

    const requestId = `req-sec-${nanoid()}`
    set({ compressPreview: { scene, text: '', loading: true } })
    let acc = ''
    streamChat(
      requestId,
      { providerId: provider.id, baseUrl: provider.baseUrl, model: provider.model, temperature: provider.temperature },
      messages,
      {
        onChunk(delta) {
          acc += delta
          set({ compressPreview: { scene, text: acc, loading: true } })
        },
        onDone(cancelled) {
          const clean = sanitizeModelOutput(acc)
          set({ compressPreview: cancelled ? null : { scene, text: clean, loading: false } })
        },
        onError(message) {
          set({ compressPreview: { scene, text: acc, loading: false, error: message } })
        },
      },
    )
  },

  showToast(kind, text) {
    set({ toast: { kind, text } })
  },
}))

// ---------- AI 调度(仓库私有) ----------

/** 每段落当前进行中的 requestId(取消与事件分发用) */
const reqIds = new Map<string, string>()
/** 每段落当前请求的完成回调,translate() 通过它等待流式结束 */
const reqCompleters = new Map<string, () => void>()
/** 重译/润色的流式暂存(不进主渲染流) */
const pendStream = new Map<string, string>()
/** 用户点击停止后登记，阻止两遍式 Pass 1 -> Pass 2 继续触发 */
const canceledIds = new Set<string>()
const autoTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleAutoTranslate(id: string, get: () => DocState, set: (p: Partial<DocState>) => void) {
  const prev = autoTimers.get(id)
  if (prev) clearTimeout(prev)
  const delay = Math.max(800, get().config.autoDelayMs)
  autoTimers.set(
    id,
    setTimeout(() => {
      autoTimers.delete(id)
      const p = get().doc.paragraphs.find((x) => x.id === id)
      if (!p || !p.zh.trim()) return
      const st = paraStatus(p, { translatingIds: get().translatingIds, failedIds: get().failedIds })
      // 停止输入后,仅对从未翻译过的段自动触发;已有译文段落不自动打扰
      if (st === 'untranslated') void runAi(id, 'translate', get, set, false)
    }, delay),
  )
}

function activeProvider(config: AppConfig): ProviderConfig | null {
  return config.providers.find((p) => p.id === config.activeProviderId) ?? null
}

function resolveProvider(config: AppConfig, mode: AiMode, isReworkPass = false): ProviderConfig | null {
  const targetId =
    mode !== 'translate' || isReworkPass
      ? config.polishProviderId || config.activeProviderId
      : config.activeProviderId
  return config.providers.find((p) => p.id === targetId) ?? activeProvider(config)
}

function omit<T extends Record<string, unknown>>(o: T, k: string): T {
  const c = { ...o }
  delete (c as Record<string, unknown>)[k]
  return c
}

function pushRecent(list: { path: string; title: string; openedAt: string }[], path: string, title: string) {
  const next = [{ path, title, openedAt: new Date().toISOString() }, ...list.filter((r) => r.path !== path)]
  return next.slice(0, 10)
}

async function askSavePath(defaultName: string): Promise<string | null> {
  return api.pickSavePath(defaultName, 'txt')
}

type RunKind = AiMode

interface SinglePassResult {
  cancelled: boolean
  text: string
  error?: string
}

function runSinglePass(
  id: string,
  provider: ProviderConfig,
  messages: ReturnType<typeof buildMessages>,
  streamToMain: boolean,
  get: () => DocState,
  set: (p: Partial<DocState>) => void,
): Promise<SinglePassResult> {
  const requestId = `req-${nanoid()}`
  reqIds.set(id, requestId)
  pendStream.delete(id)

  return new Promise<SinglePassResult>((resolve) => {
    let settled = false
    const finish = (res: SinglePassResult) => {
      if (settled) return
      settled = true
      reqIds.delete(id)
      reqCompleters.delete(id)
      pendStream.delete(id)
      resolve(res)
    }

    reqCompleters.set(id, () => finish({ cancelled: true, text: '' }))

    streamChat(
      requestId,
      { providerId: provider.id, baseUrl: provider.baseUrl, model: provider.model, temperature: provider.temperature },
      messages,
      {
        onChunk(delta) {
          if (streamToMain) {
            const cur = get().streamingEn[id] ?? ''
            set({ streamingEn: { ...get().streamingEn, [id]: cur + delta } })
          } else {
            pendStream.set(id, (pendStream.get(id) || '') + delta)
          }
        },
        onDone(cancelled) {
          const raw = streamToMain ? get().streamingEn[id] || '' : pendStream.get(id) || ''
          const text = sanitizeModelOutput(raw)
          finish({ cancelled: cancelled || canceledIds.has(id), text })
        },
        onError(message) {
          finish({ cancelled: false, text: '', error: message })
        },
      },
    )
  })
}

/**
 * AI 执行核心:
 * - 首次翻译:结果直接写入 en(同时记录 enSourceZh 快照)
 * - 已有译文(重译/润色/精缩/回炉/注入):结果进 enPending 缓冲,由用户「替换 / 丢弃」
 * - 当 translateQuality === 'two-pass' 时，翻译完成后自动执行本地体检并在存在红牌时调用润色模型纯减法回炉
 * - 失败:置 failedIds,不清空任何已编辑文本
 */
async function runAi(
  id: string,
  mode: RunKind,
  get: () => DocState,
  set: (p: Partial<DocState>) => void,
  force: boolean,
  extra?: RunExtraOpts,
) {
  const { doc, config } = get()
  const provider = resolveProvider(config, mode, false)
  if (!provider) {
    set({ settingsOpen: true, toast: { kind: 'error', text: '请先在设置中配置 API 服务' } })
    return
  }
  const para = doc.paragraphs.find((p) => p.id === id)
  if (!para) return

  if (mode === 'translate' && !para.zh.trim()) {
    set({ toast: { kind: 'info', text: '请先输入中文内容' } })
    return
  }
  if (mode !== 'translate' && !para.en.trim()) {
    set({ toast: { kind: 'info', text: '该段落还没有英文内容,请先生成英文' } })
    return
  }

  canceledIds.delete(id)
  const hasEn = para.en.trim().length > 0
  // 无英文 → 直接写入;已有英文且未被人工编辑 → 用户显式强制重译时可直写,否则一律缓冲;
  // 已被人工编辑的英文 → 一律进缓冲,绝不自动覆盖
  const intoPending = hasEn && (para.enEdited || !force)

  const glossary = pickGlossary(para.zh, parseGlossaryText(config.glossaryText))
  const idx = doc.paragraphs.findIndex((p) => p.id === id)
  const prev = idx > 0 ? doc.paragraphs[idx - 1] : null
  const coord = buildSectionCoordContext(doc.paragraphs, idx)
  const profile = doc.profile ?? config.paperProfile ?? 'nature-omics'
  const quality = config.translateQuality ?? 'high'

  // 手动按 checklist 回炉时自动采集当前段落的全部硬性问题
  let reworkFlags = extra?.reworkFlags
  let fidelityIssues = extra?.fidelityIssues
  if (mode === 'rework' && !reworkFlags && !fidelityIssues) {
    const st = analyzeParagraphStyle(para.en, para.scene)
    const zf = auditZhToEnFidelity(para.zh, para.en)
    reworkFlags = st.flags.filter((f) => f.severity === 'rework' || f.severity === 'warn')
    fidelityIssues = zf.issues
  }

  const messages = buildMessages({
    mode,
    scene: para.scene,
    profile,
    quality,
    zh: para.zh,
    en: para.en,
    prevZh: prev ? boundText(prev.zh, 400) : undefined,
    prevEn: prev ? boundText(prev.en, 600) : undefined,
    coord,
    glossary,
    customPrompt: config.customPrompt,
    reworkFlags,
    fidelityIssues,
    authorNote: extra?.authorNote,
  })

  set({
    translatingIds: { ...get().translatingIds, [id]: true },
    failedIds: omit(get().failedIds, id),
    streamingEn: intoPending ? get().streamingEn : { ...get().streamingEn, [id]: '' },
    doc: touchDoc({
      ...get().doc,
      paragraphs: get().doc.paragraphs.map((p) => (p.id === id ? { ...p, error: null } : p)),
    }),
  })

  const pass1 = await runSinglePass(id, provider, messages, !intoPending, get, set)

  if (pass1.error) {
    set({
      translatingIds: omit(get().translatingIds, id),
      streamingEn: omit(get().streamingEn, id),
      failedIds: { ...get().failedIds, [id]: true },
      doc: touchDoc({
        ...get().doc,
        paragraphs: get().doc.paragraphs.map((p) => (p.id === id ? { ...p, error: pass1.error ?? '生成失败' } : p)),
      }),
      toast: { kind: 'error', text: `生成失败:${pass1.error}` },
    })
    return
  }

  if (pass1.cancelled || canceledIds.has(id)) {
    canceledIds.delete(id)
    set({ translatingIds: omit(get().translatingIds, id), streamingEn: omit(get().streamingEn, id) })
    return
  }

  if (!pass1.text) {
    set({
      translatingIds: omit(get().translatingIds, id),
      streamingEn: omit(get().streamingEn, id),
      failedIds: { ...get().failedIds, [id]: true },
      toast: { kind: 'error', text: '模型返回了空结果,可重试' },
    })
    return
  }

  let finalText = pass1.text
  let didAutoRework = false

  // 双遍闭环精译：Pass 1 完成后本地毫秒体检；发现红牌或遗漏强数值则触发 Pass 2 纯减法回炉
  if (mode === 'translate' && quality === 'two-pass') {
    const zhCheck = auditZhToEnFidelity(para.zh, pass1.text)
    const styleCheck = analyzeParagraphStyle(pass1.text, para.scene)
    const hardStyleFlags = styleCheck.flags.filter((f) => f.severity === 'rework')

    if (!zhCheck.ok || hardStyleFlags.length > 0) {
      const reworkProvider = resolveProvider(config, 'rework', true) ?? provider
      set({ toast: { kind: 'info', text: '检测到可优化 AI 表达或数值差异，正在自动执行纯减法回炉...' } })
      const pass2Messages = buildMessages({
        mode: 'rework',
        scene: para.scene,
        profile,
        quality: 'high',
        zh: para.zh,
        en: pass1.text,
        coord,
        glossary,
        customPrompt: config.customPrompt,
        reworkFlags: hardStyleFlags,
        fidelityIssues: zhCheck.issues,
      })
      const pass2 = await runSinglePass(id, reworkProvider, pass2Messages, false, get, set)
      if (pass2.cancelled || canceledIds.has(id)) {
        canceledIds.delete(id)
        set({ translatingIds: omit(get().translatingIds, id), streamingEn: omit(get().streamingEn, id) })
        return
      }
      if (!pass2.error && pass2.text) {
        const diffGate = auditEnglishPolish(pass1.text, pass2.text)
        const zhAfter = auditZhToEnFidelity(para.zh, pass2.text)
        if (diffGate.ok || (zhCheck.issues.length > 0 && zhAfter.ok)) {
          finalText = pass2.text
          didAutoRework = true
        }
      }
    }
  }

  set({ translatingIds: omit(get().translatingIds, id), streamingEn: omit(get().streamingEn, id) })

  // 最终提示文本：区分保真告警与普通完成提示
  let statusToast: DocState['toast'] = null
  if (mode === 'translate') {
    const finalZhCheck = auditZhToEnFidelity(para.zh, finalText)
    if (!finalZhCheck.ok) {
      statusToast = {
        kind: 'info',
        text: `${didAutoRework ? '已完成两遍精译，' : ''}本地校验发现：${finalZhCheck.issues.map((i) => i.label).join('、')}`,
      }
    } else if (intoPending) {
      statusToast = { kind: 'info', text: didAutoRework ? '已完成闭环精译，请比较后选择替换或保留' : '已生成新版本,请比较后选择替换或保留' }
    } else if (didAutoRework) {
      statusToast = { kind: 'success', text: '已完成译后自动纯减法回炉并通过保真校验' }
    }
  } else {
    const enDiff = auditEnglishPolish(para.en, finalText)
    statusToast = enDiff.ok
      ? { kind: 'info', text: '已生成润色候选并完成数值/引用保真门禁，请比较后替换' }
      : { kind: 'info', text: `新版本已生成，保真门禁提醒：${enDiff.hardFlags.map((f) => f.label).join('、')}` }
  }

  if (intoPending) {
    set({
      doc: touchDoc({
        ...get().doc,
        paragraphs: get().doc.paragraphs.map((p) => (p.id === id ? { ...p, enPending: finalText, error: null } : p)),
      }),
      ...(statusToast ? { toast: statusToast } : {}),
    })
    scheduleAutoSave(get, set)
  } else {
    set({
      doc: touchDoc({
        ...get().doc,
        paragraphs: get().doc.paragraphs.map((p) =>
          p.id === id ? { ...p, en: finalText, enSourceZh: p.zh, enEdited: false, enPending: null, error: null } : p,
        ),
      }),
      ...(statusToast ? { toast: statusToast } : {}),
    })
    scheduleAutoSave(get, set)
  }
}

export { activeProvider, resolveProvider }

// 仅开发构建暴露 store 供自动化调试/测试(Vitest Node 环境无 window 时跳过)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __abw: unknown }).__abw = { store: useStore }
}
