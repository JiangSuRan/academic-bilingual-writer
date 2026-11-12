// 术语表解析与按需注入(参考 parallel-translator 的 MIT 实现,自行重写)
// 关键设计:只把当前段落中实际出现的术语发给模型,省 token 且避免无关术语干扰

export interface GlossaryPair {
  zh: string
  en: string
}

/** 每行一条,支持 `中文 => English`、`中文 → English`、`中文 -> English` 与制表符分隔;# 开头为注释 */
export function parseGlossaryText(text: string): GlossaryPair[] {
  const out: GlossaryPair[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s*(?:=>|→|->|\t)\s*/)
    if (parts.length === 2 && parts[0] && parts[1]) {
      out.push({ zh: parts[0].trim(), en: parts[1].trim() })
    }
  }
  return out
}

/** 词条渲染回编辑文本(单一事实来源仍是 config.glossaryText,编辑器直接改文本) */
export function renderGlossaryText(pairs: GlossaryPair[]): string {
  return pairs.map((p) => `${p.zh} => ${p.en}`).join('\n')
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 词边界匹配:仅对 ASCII 词形的起止端加边界断言(防止 P53 命中 P53X);
 * 中文术语无词边界概念,按子串匹配。
 */
export function termAppears(text: string, term: string): boolean {
  const t = term.trim()
  if (!t) return false
  let pattern = escapeRegExp(t)
  if (/[A-Za-z0-9]$/.test(t)) pattern += '(?![A-Za-z0-9])'
  if (/^[A-Za-z0-9]/.test(t)) pattern = `(?<![A-Za-z0-9])${pattern}`
  return new RegExp(pattern, 'iu').test(text)
}

/** 挑出当前段落命中的术语;上限 60 条,防止提示词膨胀 */
export function pickGlossary(zhText: string, pairs: GlossaryPair[]): GlossaryPair[] {
  return pairs.filter((p) => termAppears(zhText, p.zh)).slice(0, 60)
}
