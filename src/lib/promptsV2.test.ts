import { describe, expect, it } from 'vitest'
import { buildMessages, SCENE_LABELS, PROFILE_LABELS, QUALITY_LABELS } from './prompts'
import type { Scene } from '../types'

describe('biomedical-polish 深度整合 Prompt 契约', () => {
  it('覆盖全部 7 个学术写作场景（含 conclusion 与 figure_legends）', () => {
    const scenes: Scene[] = [
      'abstract',
      'introduction',
      'methods',
      'results',
      'discussion',
      'conclusion',
      'figure_legends',
    ]
    for (const s of scenes) {
      expect(SCENE_LABELS[s]).toBeTruthy()
      const [sys, usr] = buildMessages({
        mode: 'translate',
        scene: s,
        zh: '这是一段中文测试内容。',
      })
      expect(usr.content).toBe('这是一段中文测试内容。')
      expect(sys.content.length).toBeGreaterThan(80)
    }
    expect(Object.keys(PROFILE_LABELS)).toHaveLength(4)
    expect(Object.keys(QUALITY_LABELS)).toHaveLength(3)
  })

  it('translateQuality=fast 保持低指令负载以免轻量模型飘移，high 则注入体裁与交叉上下文', () => {
    const [fastSys] = buildMessages({
      mode: 'translate',
      scene: 'results',
      profile: 'cell-omics',
      quality: 'fast',
      zh: '多变量 Cox 分析证实高风险组预后显著较差（HR = 1.9, P = 0.002）。',
      coord: { resultsToOpenerCount: 3, alreadyHasDisclaimer: true },
    })
    const [highSys] = buildMessages({
      mode: 'translate',
      scene: 'results',
      profile: 'cell-omics',
      quality: 'high',
      zh: '多变量 Cox 分析证实高风险组预后显著较差（HR = 1.9, P = 0.002）。',
      coord: { resultsToOpenerCount: 3, alreadyHasDisclaimer: true },
    })
    expect(highSys.content.length).toBeGreaterThan(fastSys.content.length)
    expect(highSys.content).toContain('Cell Press')
    expect(highSys.content).toContain('To ..., we...')
  })

  it('rework 与 compress 模式携带清单与纯减法要求且保留 en 为 user 消息', () => {
    const en = 'We delve into the intricate interplay of these pathways.'
    const [reworkSys, reworkUsr] = buildMessages({
      mode: 'rework',
      scene: 'discussion',
      en,
      zh: '我们探讨了这些通路的作用。',
      reworkFlags: [
        {
          code: 'ai_lexicon_cluster',
          severity: 'rework',
          label: 'AI 高偏倚词 (delve)',
          detail: '命中 delve',
          reworkHint: '替换为 we examined',
        },
      ],
    })
    expect(reworkUsr.content).toBe(en)
    expect(reworkSys.content).toContain('pure-subtraction')
    expect(reworkSys.content).toContain('we examined')

    const [cmpSys, cmpUsr] = buildMessages({
      mode: 'compress',
      scene: 'abstract',
      en,
    })
    expect(cmpUsr.content).toBe(en)
    expect(cmpSys.content).toContain('15–25%')
  })
})
