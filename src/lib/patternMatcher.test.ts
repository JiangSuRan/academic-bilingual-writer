import { describe, expect, it } from 'vitest'
import { matchSkillPatterns } from './patternMatcher'

describe('matchSkillPatterns (on-demand 骨架匹配与隔离)', () => {
  it('根据场景与中英文关键词精准匹配生存分析 confirmed 骨架', () => {
    const res = matchSkillPatterns({
      scene: 'results',
      profile: 'nature-omics',
      zh: '多变量 Cox 生存分析显示该评分与较差总生存期独立相关（HR = 1.82）。',
    })
    expect(res.length).toBeGreaterThan(0)
    expect(res[0]?.id).toBe('survival_multivariable_cox')
    expect(res[0]?.skeleton.length).toBeGreaterThan(15)
  })

  it('[method-tool] 类算法评估骨架默认从临床队列正文隔离', () => {
    const clinicalRes = matchSkillPatterns({
      scene: 'results',
      profile: 'general-clinical',
      zh: '本研究在 120 例患者队列中构建了包含隐层特征的预后评分模型。',
    })
    const ids = clinicalRes.map((m) => m.id)
    expect(ids).not.toContain('model_construction')
    expect(ids).not.toContain('cross_dataset_generalization')
  })

  it('当选择 method-tool 体裁时允许命中 benchmarking / model_construction 骨架', () => {
    const toolRes = matchSkillPatterns({
      scene: 'results',
      profile: 'method-tool',
      zh: '在基准测试中，该编码器架构在泛化能力上优于现有基线模型。',
    })
    expect(toolRes.some((m) => m.id === 'benchmarking' || m.id === 'cross_dataset_generalization')).toBe(true)
  })
})
