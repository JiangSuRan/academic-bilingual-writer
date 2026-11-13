// 全稿学术文风体检、配额监测与按节精缩预览面板
import { useMemo } from 'react'
import { X, Activity, Scissors, Copy, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { useStore } from '../store/docStore'
import { analyzeDocumentSections, analyzeParagraphStyle, auditEnglishPolish } from '../lib/polishAudit'
import { PROFILE_LABELS, SCENE_LABELS } from '../lib/prompts'
import type { PaperProfile } from '../types'

export default function ReviewModal() {
  const doc = useStore((s) => s.doc)
  const config = useStore((s) => s.config)
  const compressPreview = useStore((s) => s.compressPreview)
  const openReview = useStore((s) => s.openReview)
  const setDocProfile = useStore((s) => s.setDocProfile)
  const generateSectionCompressPreview = useStore((s) => s.generateSectionCompressPreview)
  const clearSectionCompressPreview = useStore((s) => s.clearSectionCompressPreview)
  const showToast = useStore((s) => s.showToast)

  const effectiveProfile = doc.profile ?? config.paperProfile ?? 'nature-omics'

  const sectionReports = useMemo(
    () => analyzeDocumentSections(doc.paragraphs, effectiveProfile),
    [doc.paragraphs, effectiveProfile],
  )

  const paraStats = useMemo(() => {
    let totalWords = 0
    let reworkCount = 0
    let warnCount = 0
    for (const p of doc.paragraphs) {
      if (!p.en.trim()) continue
      const r = analyzeParagraphStyle(p.en, p.scene)
      totalWords += r.nWords
      for (const f of r.flags) {
        if (f.severity === 'rework') reworkCount++
        else if (f.severity === 'warn') warnCount++
      }
    }
    return { totalWords, reworkCount, warnCount }
  }, [doc.paragraphs])

  const previewFidelity = useMemo(() => {
    if (!compressPreview || compressPreview.loading || !compressPreview.text.trim()) return null
    const joined = doc.paragraphs
      .filter((p) => p.scene === compressPreview.scene && p.en.trim())
      .map((p) => p.en.trim())
      .join('\n\n')
    if (!joined) return null
    return auditEnglishPolish(joined, compressPreview.text)
  }, [compressPreview, doc.paragraphs])

  const copyPreview = async () => {
    if (!compressPreview?.text) return
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(compressPreview.text)
    showToast('success', '已复制精缩后的整节英文')
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && openReview(false)}>
      <div className="settings-panel review-panel">
        <div className="settings-head">
          <Activity size={16} style={{ marginRight: 8, color: 'var(--accent)' }} />
          <span>全稿学术体检与配额监测（De-AI / 保真 / 节预算）</span>
          <button onClick={() => openReview(false)} title="关闭">
            <X size={17} />
          </button>
        </div>

        <div className="settings-body">
          <div className="review-top-bar">
            <div className="review-kpis">
              <span className="kpi-chip">
                已译英文总词数：<b>{paraStats.totalWords}</b>
              </span>
              <span className={`kpi-chip ${paraStats.reworkCount > 0 ? 'bad' : 'good'}`}>
                建议回炉红牌：<b>{paraStats.reworkCount}</b> 项
              </span>
              <span className="kpi-chip">
                轻度提示：<b>{paraStats.warnCount}</b> 项
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>文稿目标体裁:</span>
              <select
                className="model-select"
                value={effectiveProfile}
                onChange={(e) => setDocProfile(e.target.value as PaperProfile)}
              >
                {(Object.keys(PROFILE_LABELS) as PaperProfile[]).map((k) => (
                  <option key={k} value={k}>
                    {PROFILE_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!sectionReports.length ? (
            <div className="review-empty">当前文稿尚无已生成英文段落，请先完成部分段落翻译后再进行整稿体检。</div>
          ) : (
            <div className="review-sections">
              {sectionReports.map((sec) => {
                const maxW = sec.budget?.maxWords ?? 0
                const pct = maxW > 0 ? Math.min(130, Math.round((sec.nWords / maxW) * 100)) : 0
                const over = maxW > 0 && sec.nWords > maxW
                return (
                  <div key={sec.scene} className="review-card">
                    <div className="rc-head">
                      <div>
                        <span className="rc-title">{SCENE_LABELS[sec.scene]}</span>
                        <span className="rc-meta">
                          {sec.nParas} 段 · {sec.nWords} 词
                          {maxW > 0 ? ` / 参考 ≤${maxW} 词 (${pct}%)` : ''} · 句长 p50=<b>{sec.sentlenP50}w</b>
                          {sec.humanP50 ? ` (顶刊基线 p50=${sec.humanP50}w / p90=${sec.humanP90}w)` : ''} · CV=
                          <b>{sec.sentlenCv}</b>
                        </span>
                      </div>
                      <button
                        className="mini-btn"
                        disabled={compressPreview?.loading}
                        onClick={() => void generateSectionCompressPreview(sec.scene)}
                        title="合并本节段落并在右侧流式生成约 -20% 精缩版预览（不覆盖原段落）"
                      >
                        <Scissors size={12} /> 精缩预览
                      </button>
                    </div>

                    {maxW > 0 && (
                      <div className="budget-bar">
                        <div className={`budget-fill ${over ? 'over' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    )}

                    {sec.issues.length === 0 ? (
                      <div className="rc-ok">
                        <CheckCircle2 size={13} /> 章节节奏、配额与跨段连贯检查未见明显异常
                      </div>
                    ) : (
                      <div className="rc-issues">
                        {sec.issues.map((it) => (
                          <div key={it.code} className={`rc-issue ${it.severity}`}>
                            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                            <div>
                              <strong>{it.label}</strong>：{it.detail}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {compressPreview && (
            <div className="compress-box">
              <div className="cb-head">
                <span>
                  {compressPreview.loading && <RefreshCw size={12} className="spinner" style={{ marginRight: 6 }} />}
                  整节精缩预览 — {SCENE_LABELS[compressPreview.scene]}
                </span>
                {previewFidelity && (
                  <span className={`audit-pill ${previewFidelity.ok ? 'good' : 'bad'}`}>
                    {previewFidelity.ok
                      ? `保真通过 · 词数 ${previewFidelity.sourceWords}→${previewFidelity.targetWords} (${previewFidelity.wordDeltaPct}%)`
                      : `注意：${previewFidelity.hardFlags.map((f) => f.label).join(' / ')}`}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {!compressPreview.loading && compressPreview.text && (
                  <button className="mini-btn primary" onClick={() => void copyPreview()}>
                    <Copy size={12} /> 复制精缩结果
                  </button>
                )}
                <button className="mini-btn" onClick={clearSectionCompressPreview}>
                  关闭预览
                </button>
              </div>
              {compressPreview.error ? (
                <div className="para-error" style={{ margin: '6px 0 0' }}>
                  <AlertTriangle size={14} /> {compressPreview.error}
                </div>
              ) : (
                <textarea
                  className="text-input"
                  rows={8}
                  readOnly
                  value={compressPreview.text}
                  style={{ fontFamily: 'var(--font-en)', marginTop: 8 }}
                />
              )}
              <p className="hint">说明：精缩预览仅供通篇压缩比对与复制参考，不会打乱工作台的一段一格中英对齐结构。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
