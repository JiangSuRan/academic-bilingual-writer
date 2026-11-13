// 段落卡片:中/英两栏共用;组合输入守卫、Enter 拆段、Backspace 并段、Ctrl+Enter 翻译
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Trash2, Copy, Sparkles, Check, X, RefreshCw, Plus, Square, AlertTriangle,
  SpellCheck, Minimize2, Wand2, Scissors, RotateCcw, CheckCircle2, MessageSquarePlus, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useStore } from '../store/docStore'
import { paraStatus, STATUS_META, splitAt } from '../lib/paragraphs'
import { nanoid } from '../lib/nanoid'
import { SCENE_LABELS } from '../lib/prompts'
import {
  analyzeParagraphStyle,
  auditEnglishPolish,
  auditZhToEnFidelity,
  suggestAuthorPrompts,
} from '../lib/polishAudit'
import type { Paragraph, Scene } from '../types'

type Side = 'zh' | 'en'

export default function ParaCard({
  para, index, side, onFocusPara,
}: {
  para: Paragraph
  index: number
  side: Side
  onFocusPara(id: string, from: Side): void
}) {
  const st = paraStatus(para, {
    translatingIds: useStore.getState().translatingIds,
    failedIds: useStore.getState().failedIds,
  })
  // 订阅本段相关的动态状态,避免整表重渲染
  const translating = useStore((s) => !!s.translatingIds[para.id])
  const failed = useStore((s) => !!s.failedIds[para.id])
  const streamed = useStore((s) => s.streamingEn[para.id])
  const active = useStore((s) => s.activeParaId === para.id)
  const fontSize = useStore((s) => (side === 'zh' ? s.config.zhFontSize : s.config.enFontSize))
  const showAuthorSlots = useStore((s) => s.config.showAuthorSlots)

  const taRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const [, forceTick] = useState(0)
  const [auditOpen, setAuditOpen] = useState(false)
  const [authorOpen, setAuthorOpen] = useState(false)
  const [authorDraft, setAuthorDraft] = useState('')

  // 自动增高:内容变化(含流式输出)后重算高度
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(56, el.scrollHeight)}px`
  })

  const displayValue =
    side === 'en' && translating && streamed !== undefined ? streamed : side === 'zh' ? para.zh : para.en

  const hasEnText = side === 'en' && !translating && para.en.trim().length > 0
  const zhAudit = useMemo(
    () => (hasEnText ? auditZhToEnFidelity(para.zh, para.en) : null),
    [hasEnText, para.zh, para.en],
  )
  const styleAudit = useMemo(
    () => (hasEnText ? analyzeParagraphStyle(para.en, para.scene) : null),
    [hasEnText, para.en, para.scene],
  )
  const authorPrompts = useMemo(
    () => (hasEnText && showAuthorSlots ? suggestAuthorPrompts(para.en, para.scene) : []),
    [hasEnText, showAuthorSlots, para.en, para.scene],
  )
  const pendingDiff = useMemo(() => {
    if (side !== 'en' || para.enPending === null || !para.en.trim()) return null
    return auditEnglishPolish(para.en, para.enPending)
  }, [side, para.en, para.enPending])
  const pendingZhDiff = useMemo(() => {
    if (side !== 'en' || para.enPending === null) return null
    return auditZhToEnFidelity(para.zh, para.enPending)
  }, [side, para.zh, para.enPending])

  const handleFocus = () => {
    useStore.getState().setActive(para.id)
    onFocusPara(para.id, side)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    // Ctrl+Enter:生成/重译当前段(组合输入期间忽略)
    if (e.ctrlKey && e.key === 'Enter' && !composingRef.current) {
      e.preventDefault()
      void useStore.getState().translate(para.id)
      return
    }
    if (side !== 'zh' || composingRef.current) return
    // 中文区 Enter:在光标处拆分为两段(Shift+Enter 保留为段内换行)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const [a, b] = splitAt(el.value, el.selectionStart)
      const store = useStore.getState()
      if (b.length === 0) {
        store.addAfter(para.id)
        // 新段获得焦点由 addAfter 的 activeParaId 驱动,此处再滚动对齐
      } else {
        const doc = store.doc
        const idx = doc.paragraphs.findIndex((p) => p.id === para.id)
        const np = makeSplit(para, a, b)
        const paras = [...doc.paragraphs]
        paras.splice(idx, 1, np[0], np[1])
        useStore.setState({ doc: { ...doc, paragraphs: paras, updatedAt: new Date().toISOString() } })
        store.setActive(np[1].id)
      }
      forceTick((t) => t + 1)
      return
    }
    // 中文区段首 Backspace:并入上一段
    if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
      const doc = useStore.getState().doc
      const idx = doc.paragraphs.findIndex((p) => p.id === para.id)
      if (idx <= 0) return
      e.preventDefault()
      const prev = doc.paragraphs[idx - 1]
      const merged: Paragraph = {
        ...prev,
        zh: prev.zh + para.zh,
        en: mergeEn(prev, para),
        enSourceZh: prev.enSourceZh !== null || para.enSourceZh !== null ? prev.zh + para.zh : prev.enSourceZh,
        enEdited: prev.enEdited || para.enEdited,
        enPending: prev.enPending || para.enPending,
        scene: para.scene,
      }
      const paras = [...doc.paragraphs]
      paras.splice(idx - 1, 2, merged)
      useStore.setState({ doc: { ...doc, paragraphs: paras, updatedAt: new Date().toISOString() } })
      useStore.getState().setActive(merged.id)
    }
  }

  const isZh = side === 'zh'
  const pending = para.enPending !== null && !isZh

  return (
    <div className={`para ${active ? 'active' : ''}`} data-para={para.id}>
      <div className="para-meta">
        <span className="para-num">{index + 1}</span>
        {!isZh && <StatusPill status={st} />}
        {isZh && translating && <StatusPill status="translating" />}
        <SceneSelect para={para} />
      </div>

      <div className="para-toolbar">
        {isZh ? (
          <>
            <button
              className="pt-btn wide"
              title="生成/重译本段英文 (Ctrl+Enter)"
              disabled={translating || !para.zh.trim()}
              onClick={() => void useStore.getState().translate(para.id)}
            >
              {para.en.trim() ? <RefreshCw size={12} /> : <Sparkles size={12} />}
              {para.en.trim() ? '重译' : '生成英文'}
            </button>
            <button className="pt-btn" title="在下方插入新段落" onClick={() => useStore.getState().addAfter(para.id)}>
              <Plus size={14} />
            </button>
            <button className="pt-btn" title="复制本段英文" disabled={!para.en.trim()} onClick={() => void useStore.getState().copyEn(para.id)}>
              <Copy size={13} />
            </button>
            <button className="pt-btn danger" title="删除本段(中英一起删除)" onClick={() => useStore.getState().remove(para.id)}>
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <>
            <EnActions para={para} translating={translating} />
            <button className="pt-btn danger" title="删除本段(中英一起删除)" onClick={() => useStore.getState().remove(para.id)}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      <textarea
        ref={taRef}
        className="para-textarea"
        style={{ fontSize }}
        value={displayValue}
        placeholder={isZh ? '在此输入中文段落…(Enter 拆分段落,Ctrl+Enter 生成英文)' : '英文译文将出现在这里;生成后可直接编辑'}
        spellCheck={side === 'en'}
        readOnly={translating && !isZh}
        data-side={side}
        onFocus={handleFocus}
        onChange={(e) => {
          const v = e.currentTarget.value
          if (isZh) useStore.getState().updateZh(para.id, v, composingRef.current)
          else useStore.getState().updateEn(para.id, v)
        }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          if (isZh) useStore.getState().updateZh(para.id, e.currentTarget.value, false)
        }}
        onKeyDown={onKeyDown}
      />

      {failed && para.error && !isZh && (
        <div className="para-error">
          <AlertTriangle size={14} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{para.error}</span>
          <button onClick={() => void useStore.getState().translate(para.id)}>重试</button>
        </div>
      )}

      {!isZh && hasEnText && styleAudit && zhAudit && (
        <div className="audit-wrap">
          <div className="audit-strip">
            <span className="audit-metrics">
              {styleAudit.nWords}w · {styleAudit.nSents}句 · p50={styleAudit.sentlenP50}w
            </span>
            <span className={`audit-pill ${zhAudit.ok ? 'good' : 'bad'}`} title="中英数值/引用/缩略词确定性锚点校验">
              {zhAudit.ok ? (
                <><CheckCircle2 size={11} /> 保真</>
              ) : (
                <><AlertTriangle size={11} /> {zhAudit.issues.map((i) => `${i.label}:${i.tokens.join(',')}`).join('；')}</>
              )}
            </span>
            {styleAudit.flags.slice(0, 3).map((flag) => (
              <button
                key={flag.code}
                className={`audit-pill clickable ${flag.severity === 'rework' ? 'bad' : flag.severity === 'warn' ? 'warn' : 'info'}`}
                onClick={() => setAuditOpen((v) => !v)}
                title={flag.detail}
              >
                {flag.label}
              </button>
            ))}
            {styleAudit.flags.length > 0 && (
              <button className="audit-toggle" onClick={() => setAuditOpen((v) => !v)}>
                {auditOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {styleAudit.flags.length} 项建议
              </button>
            )}
            {(styleAudit.reworkable || !zhAudit.ok) && (
              <button
                className="audit-rework-btn"
                onClick={() => void useStore.getState().polish(para.id, 'rework')}
                title="按以下问题清单执行纯减法回炉修正，保留全部数据与事实"
              >
                <RotateCcw size={11} /> 按清单回炉
              </button>
            )}
            {authorPrompts.length > 0 && (
              <button
                className={`audit-pill clickable ${authorOpen ? 'active' : 'info'}`}
                onClick={() => setAuthorOpen((v) => !v)}
                style={{ marginLeft: 'auto' }}
                title="可选：补充研究者第一手设计与边界说明"
              >
                <MessageSquarePlus size={11} /> 作者意图 ({authorPrompts.length})
              </button>
            )}
          </div>

          {auditOpen && styleAudit.flags.length > 0 && (
            <div className="audit-detail">
              {styleAudit.flags.map((f) => (
                <div key={f.code} className={`ad-row ${f.severity}`}>
                  <div className="ad-title">
                    <strong>{f.label}</strong>
                    <span>{f.detail}</span>
                  </div>
                  <div className="ad-hint">修改建议：{f.reworkHint}</div>
                  {f.substitutes && f.substitutes.length > 0 && (
                    <div className="ad-subs">
                      人写顶刊参考替换：
                      {f.substitutes.map((s) => (
                        <code key={s.target}>
                          {s.target} → {s.replacements.join(' / ')}
                        </code>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {authorOpen && authorPrompts.length > 0 && (
            <div className="author-slot-box">
              {authorPrompts.map((ap) => (
                <div key={ap.id} className="as-question">
                  <strong>{ap.label}：</strong>
                  <span>{ap.question}</span>
                </div>
              ))}
              <div className="as-input-row">
                <input
                  className="text-input"
                  value={authorDraft}
                  placeholder={authorPrompts[0].placeholder}
                  onChange={(e) => setAuthorDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && authorDraft.trim()) {
                      e.preventDefault()
                      const txt = authorDraft
                      setAuthorDraft('')
                      setAuthorOpen(false)
                      void useStore.getState().insertAuthorNote(para.id, txt, false)
                    }
                  }}
                />
                <button
                  className="mini-btn primary"
                  disabled={!authorDraft.trim()}
                  onClick={() => {
                    const txt = authorDraft
                    setAuthorDraft('')
                    setAuthorOpen(false)
                    void useStore.getState().insertAuthorNote(para.id, txt, false)
                  }}
                >
                  译入润色
                </button>
                <button
                  className="mini-btn"
                  disabled={!authorDraft.trim()}
                  onClick={() => {
                    const txt = authorDraft
                    setAuthorDraft('')
                    setAuthorOpen(false)
                    void useStore.getState().insertAuthorNote(para.id, txt, true)
                  }}
                  title="若输入框内已是英文句子，直接拼入新版本缓冲"
                >
                  英文直插
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {pending && (
        <div className="pending-banner">
          <div className="pb-head">
            <Wand2 size={13} /> 新版本已生成(保留原稿,确认后替换)
            {pendingDiff && (
              <span className={`audit-pill ${pendingDiff.ok ? 'good' : 'bad'}`} style={{ marginLeft: 'auto' }}>
                {pendingDiff.ok
                  ? `保真门禁通过 (${pendingDiff.sourceWords}→${pendingDiff.targetWords}w, ${
                      pendingDiff.wordDeltaPct >= 0 ? '+' : ''
                    }${pendingDiff.wordDeltaPct}%)`
                  : `注意：${pendingDiff.hardFlags.map((f) => f.label).join('；')}`}
              </span>
            )}
          </div>
          {((pendingDiff && (pendingDiff.hardFlags.length > 0 || pendingDiff.softWarnings.length > 0)) ||
            (pendingZhDiff && !pendingZhDiff.ok)) && (
            <div className="pb-diff-notes">
              {pendingDiff?.hardFlags.map((f) => (
                <div key={f.code} className="pb-note bad">
                  <strong>{f.label}：</strong>
                  {f.detail}
                </div>
              ))}
              {pendingZhDiff && !pendingZhDiff.ok && (
                <div className="pb-note bad">
                  <strong>中文锚点校验：</strong>
                  {pendingZhDiff.issues.map((i) => `${i.label} (${i.tokens.join(', ')})`).join('；')}
                </div>
              )}
              {pendingDiff?.softWarnings.map((w) => (
                <div key={w.code} className="pb-note warn">
                  <strong>{w.label}：</strong>
                  {w.detail}
                </div>
              ))}
            </div>
          )}
          <textarea value={para.enPending ?? ''} readOnly rows={Math.min(8, Math.max(2, (para.enPending ?? '').split('\n').length))} />
          <div className="pending-actions">
            <button className="accept" onClick={() => useStore.getState().acceptPending(para.id)}>
              <Check size={13} /> 替换旧版本
            </button>
            <button onClick={() => useStore.getState().discardPending(para.id)}>
              <X size={13} /> 保留原稿
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: keyof typeof STATUS_META }) {
  const m = STATUS_META[status]
  return (
    <span className={`status-pill status-${m.tone}`}>
      {status === 'translating' && <RefreshCw size={10} className="spinner" />}
      {m.label}
    </span>
  )
}

function SceneSelect({ para }: { para: Paragraph }) {
  return (
    <select
      className="scene-select"
      value={para.scene}
      title="本段写作场景"
      onChange={(e) => useStore.getState().setScene(para.id, e.target.value as Scene)}
    >
      {(Object.keys(SCENE_LABELS) as Scene[]).map((s) => (
        <option key={s} value={s}>{SCENE_LABELS[s]}</option>
      ))}
    </select>
  )
}

/** 英文区 AI 操作按钮组:润色 / 精缩 / 语法 / 简化 / 停止 */
function EnActions({ para, translating }: { para: Paragraph; translating: boolean }) {
  const hasEn = para.en.trim().length > 0
  if (translating) {
    return (
      <button className="pt-btn wide" title="停止生成" onClick={() => useStore.getState().cancel(para.id)}>
        <Square size={11} /> 停止
      </button>
    )
  }
  return (
    <>
      <button className="pt-btn wide" title="顶刊润色:改进表达,消除 AI 腔并保留全部事实" disabled={!hasEn}
        onClick={() => void useStore.getState().polish(para.id, 'polish')}>
        <Wand2 size={12} /> 润色
      </button>
      <button className="pt-btn wide" title="精缩:纯减法削减 15-25% 冗余修饰,严格保真" disabled={!hasEn}
        onClick={() => void useStore.getState().polish(para.id, 'compress')}>
        <Scissors size={12} /> 精缩
      </button>
      <button className="pt-btn wide" title="语法检查:最小修正" disabled={!hasEn}
        onClick={() => void useStore.getState().polish(para.id, 'grammar')}>
        <SpellCheck size={12} /> 语法
      </button>
      <button className="pt-btn wide" title="简化:保留原意精简表达" disabled={!hasEn}
        onClick={() => void useStore.getState().polish(para.id, 'simplify')}>
        <Minimize2 size={12} /> 简化
      </button>
    </>
  )
}

/** Enter 拆段:两段各自的快照与编辑标记按内容归属重算 */
function makeSplit(para: Paragraph, a: string, b: string): [Paragraph, Paragraph] {
  const belongsToA = para.enSourceZh === null || (para.enSourceZh ?? '').startsWith(a) || a.length >= (para.enSourceZh ?? '').length
  return [
    { ...para, zh: a, enSourceZh: belongsToA ? (para.enSourceZh ?? a) : para.enSourceZh },
    { ...para, id: nanoid(), zh: b, en: '', enSourceZh: null, enEdited: false, enPending: null, error: null },
  ]
}

/** 并段时的英文处理:两段都有英文则拼接,否则保留有内容的一侧 */
function mergeEn(prev: Paragraph, cur: Paragraph): string {
  if (prev.en.trim() && cur.en.trim()) return `${prev.en} ${cur.en}`.trim()
  return (prev.en.trim() ? prev.en : cur.en).trim()
}
