// 段落级纯逻辑:状态派生、导出文本、AI 输出清洗、拆分合并
// 全部为无副作用函数,便于单元测试

import type { Paragraph, ParaStatus } from '../types'

export interface StatusCtx {
  translatingIds: Record<string, true>
  failedIds: Record<string, true>
}

/** 派生段落显示状态;enPending 以独立横幅呈现,不挤占六种基础状态 */
export function paraStatus(p: Paragraph, ctx: StatusCtx): ParaStatus {
  if (ctx.translatingIds[p.id]) return 'translating'
  if (ctx.failedIds[p.id]) return 'failed'
  if (!p.en.trim()) return 'untranslated'
  if (p.enEdited) return 'enEdited'
  if (p.enSourceZh !== null && p.zh !== p.enSourceZh) return 'zhModified'
  return 'generated'
}

export const STATUS_META: Record<ParaStatus, { label: string; tone: string }> = {
  untranslated: { label: '未翻译', tone: 'gray' },
  generated: { label: '已生成', tone: 'green' },
  zhModified: { label: '中文已修改', tone: 'amber' },
  enEdited: { label: '英文已人工编辑', tone: 'teal' },
  translating: { label: '翻译中', tone: 'blue' },
  failed: { label: '生成失败', tone: 'red' },
}

/** 中文是否相对生成时的快照发生了变化(有英文且非人工快照缺失时才有意义) */
export function zhModified(p: Paragraph): boolean {
  return p.en.trim().length > 0 && p.enSourceZh !== null && p.zh !== p.enSourceZh
}

/** 拆分:在光标处把一个段落分成两段 */
export function splitAt(text: string, pos: number): [string, string] {
  return [text.slice(0, pos), text.slice(pos)]
}

/** 合并:Backspace 在段首时把内容并入前一段(直接拼接,不加额外分隔) */
export function mergeText(prev: string, next: string): string {
  return prev + next
}

/** 复制/导出英文全文:仅保留非空英文段落,段落间以空行分隔(Word 粘贴即分段) */
export function buildEnglishExport(paras: Paragraph[]): string {
  return paras
    .map((p) => p.en.replace(/[ \t]+$/gm, '').trim())
    .filter(Boolean)
    .join('\n\n')
}

/** 导出中英双语 TXT:逐段「中文 + 英文」成对呈现 */
export function buildBilingualExport(paras: Paragraph[]): string {
  return paras
    .map((p, i) => {
      const zh = p.zh.replace(/[ \t]+$/gm, '').trim()
      const en = p.en.replace(/[ \t]+$/gm, '').trim()
      const head = `── 段落 ${i + 1} ──`
      return en ? `${head}\n${zh}\n\n${en}` : `${head}\n${zh}`
    })
    .join('\n\n')
}

/**
 * 清洗模型输出:去首尾空白、剥离整体包裹的代码围栏与引号。
 * 只做保守清理,不改动正文内容本身。
 */
export function sanitizeModelOutput(raw: string): string {
  let t = raw.replace(/\r\n/g, '\n').trim()
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(t)
  if (fence) t = fence[1].trim()
  if (t.length >= 2) {
    const head = t[0]
    if ((head === '"' && t.endsWith('"')) || (head === '"' && t.endsWith('"'))) {
      t = t.slice(1, -1).trim()
    }
  }
  return t
}

/** 有界上下文:取尾部以贴近当前段落(衔接用途) */
export function boundText(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return '…' + t.slice(t.length - max)
}

export function countWords(text: string): number {
  const t = text.trim()
  if (!t) return 0
  // 中文按字计,英文按词计,医学稿件混合场景取两者之和的近似
  const cjk = (t.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const latin = (t.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9.'-]*/g) || []).length
  return cjk + latin
}
