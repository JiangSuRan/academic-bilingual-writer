// 段落卡片:中/英两栏共用;组合输入守卫、Enter 拆段、Backspace 并段、Ctrl+Enter 翻译
import { useEffect, useRef, useState } from 'react'
import {
  Trash2, Copy, Sparkles, Check, X, RefreshCw, Plus, Square, AlertTriangle,
  SpellCheck, Minimize2, Wand2,
} from 'lucide-react'
import { useStore } from '../store/docStore'
import { paraStatus, STATUS_META, splitAt } from '../lib/paragraphs'
import { nanoid } from '../lib/nanoid'
import { SCENE_LABELS } from '../lib/prompts'
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

  const taRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const [, forceTick] = useState(0)

  // 自动增高:内容变化(含流式输出)后重算高度
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(56, el.scrollHeight)}px`
  })

  const displayValue =
    side === 'en' && translating && streamed !== undefined ? streamed : side === 'zh' ? para.zh : para.en

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

      {pending && (
        <div className="pending-banner">
          <div className="pb-head">
            <Wand2 size={13} /> 新版本已生成(保留原稿,确认后替换)
          </div>
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

/** 英文区 AI 操作按钮组:润色 / 语法 / 简化 / 停止 */
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
      <button className="pt-btn wide" title="润色:改进表达,保留全部事实" disabled={!hasEn}
        onClick={() => void useStore.getState().polish(para.id, 'polish')}>
        <Wand2 size={12} /> 润色
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
