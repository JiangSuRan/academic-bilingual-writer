// 双栏工作区:宽度拖拽、滚动同步、按段定位(焦点锚定)
import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { AArrowDown, AArrowUp, Type } from 'lucide-react'
import { useStore } from '../store/docStore'
import ParaCard from './ParaCard'

export default function Workspace() {
  const config = useStore((s) => s.config)
  const updateConfig = useStore((s) => s.updateConfig)
  const splitRatio = config.splitRatio
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const dividerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const syncLockRef = useRef<'left' | 'right' | null>(null)
  const lockTimerRef = useRef<number>(0)

  // 拖拽分隔线:按窗口宽度计算比例,限制在 25%–75%
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const total = leftRef.current!.parentElement!.clientWidth - 5
      const ratio = Math.min(0.75, Math.max(0.25, (e.clientX - leftRef.current!.getBoundingClientRect().left) / total))
      void updateConfig({ splitRatio: ratio })
    }
    const onUp = () => {
      draggingRef.current = false
      dividerRef.current?.classList.remove('dragging')
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [updateConfig])

  /** 滚动同步:带锁防止回环;锁 120ms 后自动释放 */
  const syncScroll = useCallback((from: 'left' | 'right') => {
    if (syncLockRef.current && syncLockRef.current !== from) return
    syncLockRef.current = from
    const src = from === 'left' ? leftRef.current : rightRef.current
    const dst = from === 'left' ? rightRef.current : leftRef.current
    if (src && dst && dst.scrollHeight > dst.clientHeight) {
      const max = src.scrollHeight - src.clientHeight
      dst.scrollTop = max > 0 ? (src.scrollTop / (max || 1)) * (dst.scrollHeight - dst.clientHeight) : 0
    }
    window.clearTimeout(lockTimerRef.current)
    lockTimerRef.current = window.setTimeout(() => { syncLockRef.current = null }, 120)
  }, [])

  /** 按段定位:一侧段落获得焦点时,对侧滚动到同一段落 */
  const locateTwin = useCallback((id: string, from: 'zh' | 'en') => {
    const src = from === 'zh' ? leftRef.current : rightRef.current
    const dst = from === 'zh' ? rightRef.current : leftRef.current
    if (!src || !dst) return
    const el = src.querySelector<HTMLElement>(`[data-para="${id}"]`)
    const twin = dst.querySelector<HTMLElement>(`[data-para="${id}"]`)
    if (!el || !twin) return
    syncLockRef.current = from === 'zh' ? 'right' : 'left'
    const target = twin.offsetTop - dst.offsetTop - 24
    dst.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    window.clearTimeout(lockTimerRef.current)
    lockTimerRef.current = window.setTimeout(() => { syncLockRef.current = null }, 300)
  }, [])

  const changeFont = (side: 'zh' | 'en', delta: number) => {
    const key = side === 'zh' ? 'zhFontSize' : 'enFontSize'
    const cur = side === 'zh' ? config.zhFontSize : config.enFontSize
    void updateConfig({ [key]: Math.min(24, Math.max(12, cur + delta)) })
  }

  // 响应式段落计数(有内容才算)
  const allParas = useStore((s) => s.doc.paragraphs)
  const zhCount = allParas.filter((p) => p.zh.trim()).length
  const enCount = allParas.filter((p) => p.en.trim()).length

  return (
    <div className="workspace">
      <div className="pane pane-left" style={{ width: `${splitRatio * 100}%` }}>
        <div className="pane-head">
          <span className="pane-title">中文写作</span>
          <span className="pane-count">{zhCount} 段</span>
          <span className="font-ctl">
            <Type size={12} style={{ color: 'var(--text-3)' }} />
            <button title="减小中文字号" onClick={() => changeFont('zh', -1)}><AArrowDown size={14} /></button>
            <button title="增大中文字号" onClick={() => changeFont('zh', 1)}><AArrowUp size={14} /></button>
          </span>
        </div>
        <ParaScroll side="zh" scrollRef={leftRef} onScroll={() => syncScroll('left')} onFocusPara={locateTwin} />
      </div>
      <div
        ref={dividerRef}
        className="divider"
        onMouseDown={() => {
          draggingRef.current = true
          dividerRef.current?.classList.add('dragging')
          document.body.style.cursor = 'col-resize'
        }}
      />
      <div className="pane pane-right" style={{ flex: 1 }}>
        <div className="pane-head">
          <span className="pane-title">学术英文</span>
          <span className="pane-count">{enCount} 段</span>
          <span className="font-ctl">
            <Type size={12} style={{ color: 'var(--text-3)' }} />
            <button title="减小英文字号" onClick={() => changeFont('en', -1)}><AArrowDown size={14} /></button>
            <button title="增大英文字号" onClick={() => changeFont('en', 1)}><AArrowUp size={14} /></button>
          </span>
        </div>
        <ParaScroll side="en" scrollRef={rightRef} onScroll={() => syncScroll('right')} onFocusPara={locateTwin} />
      </div>
    </div>
  )
}

function ParaScroll({
  side, scrollRef, onScroll, onFocusPara,
}: {
  side: 'zh' | 'en'
  scrollRef: RefObject<HTMLDivElement>
  onScroll(): void
  onFocusPara(id: string, from: 'zh' | 'en'): void
}) {
  const paras = useStore((s) => s.doc.paragraphs)
  return (
    <div ref={scrollRef} className="para-scroll" onScroll={onScroll}>
      {paras.map((p, i) => (
        <ParaCard key={p.id} para={p} index={i} side={side} onFocusPara={onFocusPara} />
      ))}
      <div className="tail-actions">
        <button onClick={() => useStore.getState().addAfter(useStore.getState().doc.paragraphs.at(-1)?.id ?? null)}>
          + 添加段落
        </button>
      </div>
    </div>
  )
}
