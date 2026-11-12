import { describe, expect, it } from 'vitest'
import { buildMessages } from './prompts'

const base = {
  mode: 'translate' as const,
  scene: 'results' as const,
  zh: '两组间差异具有统计学意义(P < 0.05)。',
}

describe('提示词组装', () => {
  it('翻译请求正文在 user,场景与统计红线在 system', () => {
    const [sys, user] = buildMessages(base)
    expect(sys.role).toBe('system')
    expect(user.content).toContain('P < 0.05')
    expect(sys.content).toContain('associated with')
    expect(sys.content).toContain('HR、OR')
    expect(sys.content).toContain('Results')
    // 场景标签不得出现在 user 消息(弱模型会把标签当作正文翻译)
    expect(user.content).not.toContain('Results')
    expect(user.content).not.toContain('【写作场景】')
  })
  it('术语表注入为映射格式(位于 system)', () => {
    const [sys, user] = buildMessages({ ...base, glossary: [{ zh: '转移', en: 'metastasis' }] })
    expect(sys.content).toContain('术语表')
    expect(sys.content).toContain('转移 => metastasis')
    expect(user.content).not.toContain('metastasis')
  })
  it('无术语时不出现在请求里', () => {
    const [sys] = buildMessages(base)
    expect(sys.content).not.toContain('【术语表(必须按此翻译')
  })
  it('上下文块标注为参考,不进入正文', () => {
    const [sys, user] = buildMessages({ ...base, prevZh: '上一段中文', prevEn: 'previous paragraph' })
    expect(sys.content).toContain('不要翻译或输出')
    expect(sys.content).toContain('previous paragraph')
    expect(user.content).not.toContain('previous paragraph')
  })
  it('润色请求携带待处理英文', () => {
    const [sys, user] = buildMessages({ ...base, mode: 'polish', en: 'The p value was significant.' })
    expect(sys.content).toContain('润色')
    expect(user.content).toContain('The p value was significant.')
  })
  it('自定义提示词附加且声明不可覆盖硬性规则', () => {
    const [sys] = buildMessages({ ...base, customPrompt: 'Use British spelling.' })
    expect(sys.content).toContain('Use British spelling.')
    expect(sys.content).toContain('不覆盖')
  })
  it('五个场景均有各自风格提示', () => {
    const scenes = ['abstract', 'introduction', 'methods', 'results', 'discussion'] as const
    for (const scene of scenes) {
      const [sys] = buildMessages({ ...base, scene })
      expect(sys.content.toLowerCase()).toContain(scene)
    }
  })
})
