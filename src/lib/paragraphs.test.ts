import { describe, expect, it } from 'vitest'
import {
  paraStatus, zhModified, buildEnglishExport, buildBilingualExport,
  sanitizeModelOutput, boundText, splitAt, countWords,
} from './paragraphs'
import { makeParagraph } from '../store/docStore'
import type { Paragraph } from '../types'

const NO_CTX = { translatingIds: {}, failedIds: {} }

function para(patch: Partial<Paragraph>): Paragraph {
  return { ...makeParagraph(), zh: '原文', ...patch }
}

describe('段落状态派生', () => {
  it('无英文为未翻译', () => {
    expect(paraStatus(para({ en: '' }), NO_CTX)).toBe('untranslated')
  })
  it('有英文且快照一致为已生成', () => {
    expect(paraStatus(para({ en: 'Result', enSourceZh: '原文' }), NO_CTX)).toBe('generated')
  })
  it('中文修改后派生为中文已修改,且不丢失旧译文', () => {
    const p = para({ en: 'Old translation', enSourceZh: 'old zh', zh: 'new zh' })
    expect(paraStatus(p, NO_CTX)).toBe('zhModified')
    expect(zhModified(p)).toBe(true)
    expect(p.en).toBe('Old translation') // 旧译文仍在
  })
  it('人工编辑优先级最高', () => {
    const p = para({ en: 'Edited', enSourceZh: 'x', zh: 'y', enEdited: true })
    expect(paraStatus(p, NO_CTX)).toBe('enEdited')
  })
  it('翻译中与失败状态来自运行时上下文', () => {
    const p = para({ en: '', zh: 'x' })
    expect(paraStatus(p, { translatingIds: { [p.id]: true }, failedIds: {} })).toBe('translating')
    expect(paraStatus(p, { translatingIds: {}, failedIds: { [p.id]: true } })).toBe('failed')
  })
  it('快照缺失时中文修改不误报(enSourceZh 为 null)', () => {
    const p = para({ en: 'some en', enSourceZh: null, zh: '随便改' })
    expect(zhModified(p)).toBe(false)
  })
})

describe('复制/导出文本', () => {
  it('英文全文:跳过空段,双换行分段,不含任何标记', () => {
    const paras = [
      para({ en: 'First paragraph.', zh: '一' }),
      para({ en: '', zh: '二' }),
      para({ en: 'Second paragraph.', zh: '三' }),
    ]
    expect(buildEnglishExport(paras)).toBe('First paragraph.\n\nSecond paragraph.')
  })
  it('导出内容保留统计符号、希腊字母与基因名', () => {
    const en = 'TP53 expression increased (HR = 1.82, 95% CI 1.2–2.7, P < 0.001); α = 0.05, β-actin.'
    const out = buildEnglishExport([para({ en })])
    expect(out).toContain('HR = 1.82')
    expect(out).toContain('95% CI 1.2–2.7')
    expect(out).toContain('α')
    expect(out).toContain('β-actin')
    expect(out).toContain('TP53')
  })
  it('双语导出按段成对', () => {
    const out = buildBilingualExport([para({ zh: '方法', en: 'Methods.' })])
    expect(out).toContain('方法')
    expect(out).toContain('Methods.')
    expect(out).toContain('段落 1')
  })
})

describe('模型输出清洗', () => {
  it('剥离整体代码围栏', () => {
    expect(sanitizeModelOutput('```text\nHello\n```')).toBe('Hello')
    expect(sanitizeModelOutput('```\nHello\n```')).toBe('Hello')
  })
  it('剥离整体包裹引号', () => {
    expect(sanitizeModelOutput('"Hello world"')).toBe('Hello world')
  })
  it('不破坏正文内部的围栏或引号', () => {
    expect(sanitizeModelOutput('He said "ok" and left.')).toBe('He said "ok" and left.')
    expect(sanitizeModelOutput('```text\nabc\n``` inside')).toBe('```text\nabc\n``` inside')
  })
  it('去除首尾空白与 CRLF', () => {
    expect(sanitizeModelOutput('  a\r\nb  ')).toBe('a\nb')
  })
})

describe('拆分与上下文', () => {
  it('光标处拆分', () => {
    expect(splitAt('abcdef', 3)).toEqual(['abc', 'def'])
    expect(splitAt('abc', 0)).toEqual(['', 'abc'])
  })
  it('有界上下文取尾部', () => {
    const s = 'x'.repeat(100) + 'TAIL'
    const out = boundText(s, 10)
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('TAIL')).toBe(true)
    expect(out.length).toBe(11)
    expect(boundText('short', 10)).toBe('short')
  })
  it('字数统计中英混合', () => {
    expect(countWords('患者 128 例,p53 阳性')).toBeGreaterThan(0)
    expect(countWords('')).toBe(0)
  })
})
