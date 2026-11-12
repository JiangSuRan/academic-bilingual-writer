import { describe, expect, it } from 'vitest'
import { parseGlossaryText, termAppears, pickGlossary, renderGlossaryText } from './glossary'

describe('术语表解析', () => {
  it('支持三种分隔符与注释、空行', () => {
    const pairs = parseGlossaryText(
      '# 注释\n免疫检查点 => immune checkpoint\n无病生存期 → disease-free survival\n卡方检验 -> chi-square test\n\n坏行\n',
    )
    expect(pairs).toEqual([
      { zh: '免疫检查点', en: 'immune checkpoint' },
      { zh: '无病生存期', en: 'disease-free survival' },
      { zh: '卡方检验', en: 'chi-square test' },
    ])
  })
  it('渲染回文本可再次解析(往返一致)', () => {
    const pairs = [{ zh: '肿瘤', en: 'tumor' }]
    expect(parseGlossaryText(renderGlossaryText(pairs))).toEqual(pairs)
  })
})

describe('术语按需注入', () => {
  it('ASCII 词形带边界:完整词命中', () => {
    expect(termAppears('检测 P53 蛋白表达', 'P53')).toBe(true)
    expect(termAppears('P53X protein', 'P53')).toBe(false)
    expect(termAppears('the gene TP53.', 'TP53')).toBe(true)
  })
  it('中文术语按子串匹配', () => {
    expect(termAppears('肿瘤细胞发生转移', '转移')).toBe(true)
    expect(termAppears('这是一个基因', '基因')).toBe(true)
    expect(termAppears('未见转移灶', '转移')).toBe(true)
  })
  it('pickGlossary 只返回当前段落命中的术语', () => {
    const pairs = [
      { zh: '免疫检查点', en: 'immune checkpoint' },
      { zh: '转移', en: 'metastasis' },
    ]
    const picked = pickGlossary('肿瘤细胞发生转移', pairs)
    expect(picked).toEqual([{ zh: '转移', en: 'metastasis' }])
  })
})
