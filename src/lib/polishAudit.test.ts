import { describe, expect, it } from 'vitest'
import {
  analyzeDocumentSections,
  analyzeParagraphStyle,
  auditEnglishPolish,
  auditZhToEnFidelity,
  buildSectionCoordContext,
  suggestAuthorPrompts,
} from './polishAudit'
import { makeParagraph } from '../store/docStore'

describe('auditEnglishPolish (fidelity_diff 移植)', () => {
  it('科学记数法等价归一化不应误报数字变化', () => {
    const src = 'Differential genes reached P = 2.3 × 10⁻⁵ across n = 48 paired tumors [1-3].'
    const dst = 'Differential expression achieved significance at P = 2.3e-5 across 48 paired tumors [1, 2, 3].'
    const rep = auditEnglishPolish(src, dst)
    expect(rep.ok).toBe(true)
    expect(rep.hardFlags).toHaveLength(0)
  })

  it('不把期刊卷期括号误判为文献引用', () => {
    const src = 'We reproduced the signature from Nature 626(7998) using log1p(10) scaling.'
    const dst = 'This signature from Nature 626(7998) was verified with log1p(10) normalization.'
    const rep = auditEnglishPolish(src, dst)
    expect(rep.hardFlags.filter((f) => f.code === 'missing_citation' || f.code === 'added_citation')).toHaveLength(0)
  })

  it('检出缺失数字、丢失可复现参数与否定反转', () => {
    const src = 'Clusters were built with seed = 42 and nboot = 1000, and were not associated with survival (HR = 1.45) [4].'
    const dst = 'Clusters were built and were strongly associated with survival (HR = 1.45).'
    const rep = auditEnglishPolish(src, dst)
    expect(rep.ok).toBe(false)
    const codes = rep.hardFlags.map((f) => f.code)
    expect(codes).toContain('dropped_repro_param')
    expect(codes).toContain('negation_flipped')
    expect(codes).toContain('missing_citation')
  })

  it('检出关联词升格因果与篇幅膨胀', () => {
    const src = 'HighSPP1 expression was associated with worse prognosis in LUAD patients.'
    const dst =
      'HighSPP1 expression crucially drove worse clinical prognosis in LUAD patients by substantially activating multifaceted downstream tumorigenic pathways across diverse microenvironments in this cohort.'
    const rep = auditEnglishPolish(src, dst)
    const warnCodes = rep.softWarnings.map((w) => w.code)
    expect(warnCodes).toContain('added_causal')
    expect(warnCodes).toContain('word_bloat')
  })
})

describe('auditZhToEnFidelity (中英事实锚点校验)', () => {
  it('正常保留数值、引用与基因缩略词时返回 ok', () => {
    const zh = '在 TCGA 队列的 128 例肺腺癌患者中，TP53 突变与较短 OS 相关（HR = 1.68，P = 0.004）[2]。'
    const en = 'Among 128 patients with lung adenocarcinoma in TCGA, TP53 mutations were associated with shorter OS (HR = 1.68, P = 0.004) [2].'
    const rep = auditZhToEnFidelity(zh, en)
    expect(rep.ok).toBe(true)
    expect(rep.issues).toHaveLength(0)
  })

  it('允许小整数写为英文词，但检出遗漏百分数、大数字、引用与基因词', () => {
    const zh = '3个队列共纳入 240 例样本，缓解率达 42.5%，EGFR 通路显著富集 [5]。'
    const en = 'Across three cohorts, patients showed favorable responses.'
    const rep = auditZhToEnFidelity(zh, en)
    expect(rep.ok).toBe(false)
    const codes = rep.issues.map((i) => i.code)
    expect(codes).toContain('missing_number')
    expect(codes).toContain('missing_citation')
    expect(codes).toContain('missing_term')
  })

  it('检出英文译文意外残留中文字符', () => {
    const rep = auditZhToEnFidelity('共纳入 50 例样本。', 'We included 50 例 samples.')
    expect(rep.ok).toBe(false)
    expect(rep.issues[0]?.code).toBe('unexpected_zh')
  })
})

describe('analyzeParagraphStyle (De-AI 与作者声音体检)', () => {
  it('检出 AI 词簇并附带 human_substitutes 人写替代建议', () => {
    const text =
      'Herein, we delve into the multifaceted and intricate interplay of myeloid remodeling, unveiling a pivotal role in tumor evasion.'
    const rep = analyzeParagraphStyle(text, 'abstract')
    expect(rep.reworkable).toBe(true)
    const aiFlag = rep.flags.find((f) => f.code === 'ai_lexicon_cluster')
    expect(aiFlag).toBeDefined()
    expect(aiFlag?.substitutes?.length).toBeGreaterThan(0)
  })

  it('严格豁免 CNS 高频合法域词 (robust/landscape/comprehensive/associated with)', () => {
    const text =
      'This comprehensive spatial landscape revealed a robust metabolic program associated with progression across 64 tumors (P < 0.001).'
    const rep = analyzeParagraphStyle(text, 'results')
    expect(rep.flags.find((f) => f.code === 'ai_lexicon_cluster')).toBeUndefined()
  })

  it('检出 >32 词伴随分词三层长句与代码变量泄露', () => {
    const text =
      'Samples were pre-processed with deg_filtered_list and computeCommunProb across cohorts, where malignant clusters showed elevated activity, whereas exhausted T cells declined in frequency while Stromal counts rose steadily, thereby confirming that microenvironment remodeling accompanies tumor invasion across all tested tissue compartments.'
    const rep = analyzeParagraphStyle(text, 'results')
    const codes = rep.flags.map((f) => f.code)
    expect(codes).toContain('clause_stuffed_long')
    expect(codes).toContain('code_identifier_leak')
  })

  it('检出 Results 内反复免责、升华收尾与人名连发堆砌', () => {
    const text =
      'Smith et al. showed that MYC promotes proliferation [1]. Lee et al. reported that MYC correlates with metastasis [2]. Collectively, these findings underscore the translational promise of targeting MYC. These observations should be interpreted with caution.'
    const rep = analyzeParagraphStyle(text, 'results')
    const codes = rep.flags.map((f) => f.code)
    expect(codes).toContain('author_call_stacking')
    expect(codes).toContain('symmetric_paragraph_ending')
    expect(codes).toContain('repetitive_tail_disclaimer')
  })
})

describe('analyzeDocumentSections & suggestAuthorPrompts', () => {
  it('按体裁校验摘要预算并识别连续同型开篇与跨段上下文', () => {
    const longAbs = { ...makeParagraph('abstract'), en: Array(170).fill('word').join(' ') + '.' }
    const p1 = { ...makeParagraph('results'), en: 'To test whether A correlates with B, we analyzed 50 samples.' }
    const p2 = { ...makeParagraph('results'), en: 'To assess pathway shifts, we scored hallmark gene sets.' }
    const p3 = { ...makeParagraph('results'), en: 'To examine survival, we fit a multivariable Cox model.' }

    const cellReports = analyzeDocumentSections([longAbs, p1, p2, p3], 'cell-omics')
    const absRep = cellReports.find((r) => r.scene === 'abstract')
    const resRep = cellReports.find((r) => r.scene === 'results')
    expect(absRep?.issues.some((i) => i.code === 'section_over_budget')).toBe(true)
    expect(resRep?.issues.some((i) => i.code === 'paragraph_template_repetition')).toBe(true)

    const coord = buildSectionCoordContext([p1, p2, p3], 2)
    expect(coord.resultsToOpenerCount).toBe(2)
    expect(coord.prevOpenerType).toBe('to_infinitive')
  })

  it('在方法决策与局限段落自动触发作者注入槽问题', () => {
    const m = 'We chose Leiden clustering rather than hierarchical merging to preserve rare transitional states.'
    const d = 'These retrospective findings cannot establish direct causality and remain to be tested in prospective trials.'
    expect(suggestAuthorPrompts(m, 'methods').some((s) => s.id === 'choice')).toBe(true)
    expect(suggestAuthorPrompts(d, 'discussion').some((s) => s.id === 'limit')).toBe(true)
  })
})
