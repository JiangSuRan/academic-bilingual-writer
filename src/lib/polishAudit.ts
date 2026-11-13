/**
 * 确定性学术润色审计与文风体检引擎。
 * 逻辑对齐 biomedical-polish Skill 中的 fidelity_diff.py、style_metrics.py 与 author_prompts.py，
 * 在浏览器端毫秒级运行，零 LLM Token 消耗。
 */
import skillBundle from '../data/biomedicalSkill.json'
import type { PaperProfile, Paragraph, Scene } from '../types'
import { boundText } from './paragraphs'

// ---------- 来自 biomedical-polish Skill 的常量与正则 ----------

const ABBREV = [
  'et al',
  'e.g',
  'i.e',
  'Fig',
  'Figs',
  'Eq',
  'Eqs',
  'Ref',
  'Refs',
  'vs',
  'approx',
  'Sec',
  'Sect',
  'Suppl',
  'cf',
  'ca',
  'Dr',
  'St',
  'Tab',
  'min',
  'max',
  'resp',
  'vol',
]

const SUPER_MAP: Record<string, string> = {
  '\u207b': '-',
  '\u207a': '+',
  '\u2070': '0',
  '\u00b9': '1',
  '\u00b2': '2',
  '\u00b3': '3',
  '\u2074': '4',
  '\u2075': '5',
  '\u2076': '6',
  '\u2077': '7',
  '\u2078': '8',
  '\u2079': '9',
}

const NEGATION_WORDS = [
  'not',
  'no',
  'never',
  'neither',
  'nor',
  'without',
  'none',
  'lacked',
  'absent',
  'excluding',
  'precluding',
  'unadjusted',
]

const CAUSAL_PATTERNS = [
  'thereby',
  'leading to',
  'resulting in',
  'drove',
  'drives',
  'driven by',
  'caused',
  'causes',
  'induced',
  'induces',
]

const QUALIFIER_PATTERNS = [
  'may',
  'might',
  'could',
  'in part',
  'partially',
  'associated with',
  'consistent with',
  'suggest',
  'suggests',
  'suggested',
]

const IDENT_WHITELIST = new Set([
  'OS', 'CNV', 'GSEA', 'DEG', 'DEGS', 'DOI', 'FBS', 'OR', 'MICRORNA', 'DMSO',
  'WHO', 'WGCNA', 'PFS', 'URL', 'CUT', 'GEO', 'AUROC', 'GSVA', 'ICGC', 'EMT',
  'TMB', 'FDR', 'QC', 'MSI', 'SCRNA', 'TF', 'HRD', 'BCR', 'KPS', 'CHIP',
  'MOFA', 'ANOVA', 'GTEX', 'FDA', 'DFS', 'PCA', 'MIN', 'SV', 'MRNA', 'LNCRNA',
  'RAM', 'CPU', 'UMI', 'IBD', 'SCANPY', 'SNATAC', 'PCR', 'ELISA', 'MAX',
  'HIPAA', 'HR', 'MHC', 'TCR', 'HLA', 'PAGE', 'KEGG', 'SCATAC', 'WNN', 'EDTA',
  'FACS', 'ROC', 'ATAC', 'CIBERSORT', 'SNP', 'AUC', 'HE', 'DNA', 'ATP', 'GO',
  'PBS', 'UMAP', 'SE', 'TCGA', 'SEURAT', 'SSGSEA', 'DMEM', 'SNV', 'FFPE',
  'LRT', 'SD', 'TNM', 'RNA', 'IQR', 'TSNE', 'EOF', 'GPS', 'CI', 'IRB', 'SDS',
  'LM22', 'GPU', 'AJCC', 'NK', 'IRR', 'ECOG', 'REACTOME', 'PMID', 'SCVI', 'SEM',
  'FDR', 'USA', 'UK', 'NIH', 'COVID', 'SARS', 'HIV', 'BMI', 'CT', 'MRI',
  'WT', 'KO', 'OE', 'KD', 'NS', 'NA', 'MATH',
])

const REPRO_PARAM_RE =
  /\bseed(?:\.use)?\s*(?:=|\s)\s*\d+\b|\binitializations?\s+\d+(?:\s*,\s*\d+)*(?:\s*,?\s*and\s+\d+)?\b|\b(?:alpha\.pvals\.expli|tuneLength|deepSplit|nboot|eps|min\.count|min\.total\.count|large\.n|min\.prop|one\s+process)\s*=\s*-?\d+(?:\.\d+)?\b|\b(?:merge\s+cut\s+height|block\s+size|prior\s+count|degrees\s+of\s+freedom|maximum\s+depth|early\s+stopping|latent\s+dimension|learning\s+rate|weight\s+decay|KL\s+weight)\s*(?:of|=|\s)\s*-?\d+(?:\.\d+)?\b|\b\d+\s+(?:single-stage\s+models|combinations\s+pairing|feature\s+selectors|classifiers|trees|lambda\s+values|rounds|epochs|genes\s+per\s+bin|random\s+control\s+genes)\b/gi

const OPERATIONAL_SPAN_RE =
  /\bfloat(?:16|32|64)\b|\b(?:clipped|capped)[^.;]{0,45}?(?:±|-)?\d+(?:\.\d+)?\b|\bassigned\s+P\s*=\s*1\b|\bNon-estimable results were NA\b/gi

const BRACKET_CIT_RE = /\[(\d+(?:\s*[,;\-\u2013]\s*\d+)*)\]/g
const PAREN_CIT_STRICT_RE = /(?<![A-Za-z0-9])\((\d+(?:\s*[,;\-\u2013]\s*\d+)*)\)/g

const CODE_LEAK_RE =
  /\b[a-z]+_[a-z0-9_]{2,}\b|=(?:TRUE|FALSE|True|False|NA|NULL|\d+(?:\.\d+)?|"[^"]*")\b|\b(?:filterByExpr|computeCommunProb|scTenifoldKnk|pcNet|manifoldAlignment|fgseaMultilevel|run_ulm)\b|\b(?:Non-estimable results were NA|Absent scores were zero|Heatmap clipping affected display only)\b/g

const PARTICIPIAL_TAIL_RE =
  /,\s*(?:thereby\s+|thus\s+|further\s+)?(?:confirming|indicating|highlighting|illustrating|underscoring|demonstrating|revealing|suggesting|establishing|verifying)\s+that\b/gi

const PARTICIPIAL_TAIL_TEST_RE =
  /,\s*(?:thereby\s+|thus\s+|further\s+)?(?:confirming|indicating|highlighting|illustrating|underscoring|demonstrating|revealing|suggesting|establishing|verifying)\s+that\b/i

const SUBORDINATE_CLAUSE_RE =
  /\b(?:which|where|whereas|although|while|because|since|confirming|indicating|highlighting|illustrating|underscoring|demonstrating)\b|\brather\s+than\b|\baccompanied\s+by\b/gi

const TAIL_DISCLAIMER_RE =
  /\b(?:did not establish that|do not directly measure|do not specify whether|no [\w\s-]+ endpoint was tested|were not represented as newly rerun|without imposing a single-gene hypothesis|while leaving [\w\s-]+ to be addressed|remaining distinct from measurements of|does not imply altered|provides no evidence that|establish relative localization rather than)\b/i

const AUTHOR_CALL_RE =
  /\b[A-Z][a-z]+\s+(?:et\s+al\.|and\s+colleagues)\s+(?:independently\s+|further\s+)?(?:showed|reported|identified|demonstrated|linked|found|observed|described)\b/g

const NOMINAL_TOKEN_RE = /\b\w{3,}(?:tion|sion|ment|ance|ence|ity|ness|ism)s?\b/gi
const PASSIVE_RE = /\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/gi
const VOICE_ABSTRACT_ANAPHORA_RE =
  /\b(?:this|these)\s+(?:program|finding|findings|state|states|approach|analysis|result|results|observation|pattern|process|difference|effect)\b/gi
const VOICE_HEDGE_RE =
  /\b(?:may|might|could|possibly|potential(?:ly)?|suggests?|suggesting|likely|probabl[ey]|appears?|in part|partially|putative(?:ly)?|remains? unclear|inconclusive)\b/gi
const VOICE_DISCLAIMER_RE =
  /\b(?:should be interpreted with|be interpreted with caution|cannot (?:establish|exclude|rule out)|does not (?:imply|establish|mean)|not be interpreted as|requires? (?:further|perturbation-based)|warranted|caveat|caution is warranted|limited by the (?:absence|lack)|no direct evidence)\b/i
const VOICE_SPECIFIC_RE = /\b\d[\d,]*(?:\.\d+)?\b|\b[A-Z]{2,}[A-Z0-9]*\b|\b[A-Za-z]+\d\b/g

const UPLIFT_END_RE =
  /^(?:Collectively|Taken together|Overall|In summary|Together|Ultimately|In conclusion),?\s+(?:these|our)\s+(?:findings|results|data|observations)\b/i
const SUBHEADING_CLICHE_RE =
  /^(?:#{1,6}\s*)?(?:Unveiling|Decoding|Illuminating|Navigating|Harnessing|Dissecting|Elucidating)\b/i

const SIG_NEAR_PCT_RE =
  /\bsignificant(?:ly)?\b[^.]{0,40}\d+(?:\.\d+)?\s?%(?!\s*(?:CI|confidence))/i
const SIG_NEAR_SHARE_RE =
  /\bsignificant(?:ly)?\b[^.]{0,25}\b(?:proportion|share|percentage|mean|average|rate)s?\b|\b(?:proportion|share|percentage|mean|average|rate)s?\b\s+(?:(?:was|were|is|are|remained|became)\s+)?(?:not\s+)?significant\b/i
const FLAG_COMPARATIVE_RE = /\b(?:higher|lower|more|less|greater|smaller)\b/i
const FLAG_ANCHOR_RE = /\b(?:than|versus|vs\.?|compared|relative\s+to|over)\b/i

// author_prompts.py 正则
const AP_CHOICE_RE =
  /\b(?:we (?:used|chose|selected|applied|adopted|compared)|was used to|rather than|instead of|to avoid|prefer(?:red)?)\b/i
const AP_EXPECT_RE =
  /\b(?:unexpected(?:ly)?|surprising(?:ly)?|in contrast to|contrary to|whereas|although|despite|did not)\b/i
const AP_STAT_RE = /\b\d[\d,]*(?:\.\d+)?\b|FDR|P\s*[=<]|AUC|CI\b/
const AP_LIMIT_RE =
  /\b(?:cannot (?:establish|exclude|rule out)|should be interpreted|remains? (?:unclear|to be)|warranted|limitation)\b/i

// ---------- 导出类型 ----------

export interface FidelityFlag {
  code:
    | 'missing_number'
    | 'added_number'
    | 'missing_citation'
    | 'added_citation'
    | 'dropped_repro_param'
    | 'negation_flipped'
    | 'missing_identifier'
    | 'added_causal'
    | 'dropped_qualifier'
    | 'word_bloat'
  severity: 'hard' | 'warn'
  label: string
  detail: string
}

export interface FidelityDiffReport {
  ok: boolean
  hardFlags: FidelityFlag[]
  softWarnings: FidelityFlag[]
  sourceWords: number
  targetWords: number
  wordDeltaPct: number
}

export interface ZhEnFidelityIssue {
  code: 'missing_number' | 'missing_citation' | 'missing_term' | 'unexpected_zh'
  label: string
  tokens: string[]
}

export interface ZhEnFidelityReport {
  ok: boolean
  issues: ZhEnFidelityIssue[]
}

export type DeAiFlagCode =
  | 'ai_lexicon_cluster'
  | 'participial_ing_tail_stacking'
  | 'clause_stuffed_long'
  | 'code_identifier_leak'
  | 'repetitive_tail_disclaimer'
  | 'author_call_stacking'
  | 'excessive_nominalization'
  | 'symmetric_paragraph_ending'
  | 'subheading_template_cliche'
  | 'em_dash_clause'
  | 'sig_misattached'
  | 'unanchored_comparative'
  | 'monotonous_openings'

export interface StyleFlag {
  code: DeAiFlagCode
  severity: 'rework' | 'warn' | 'info'
  label: string
  detail: string
  /** 可直接喂给模型纯减法回炉的修改指令与替换候选 */
  reworkHint: string
  matches?: string[]
  substitutes?: Array<{ target: string; replacements: string[] }>
}

export type OpenerType = 'contrast' | 'to_infinitive' | 'we_using' | 'result_data' | 'other'

export interface ParagraphStyleReport {
  nWords: number
  nSents: number
  sentlenP50: number
  sentlenCv: number
  pctUnder12: number
  pctOver35: number
  nominalPer1k: number
  passivePer1k: number
  firstPersonPer1k: number
  abstractionIndex: number
  specificityPerSent: number
  overHedgingDensity: number
  openerType: OpenerType
  openerWord: string
  hasFinalIngTail: boolean
  hasUpliftEnding: boolean
  hasTailDisclaimer: boolean
  flags: StyleFlag[]
  reworkable: boolean
}

export interface AuthorPromptSuggestion {
  id: 'choice' | 'expect' | 'stat' | 'limit'
  label: string
  question: string
  placeholder: string
}

export interface SectionBudgetSpec {
  maxWords: number
  maxParas?: number
  maxSents?: number
}

export interface SectionHealthReport {
  scene: Scene
  nParas: number
  nWords: number
  nSents: number
  sentlenP50: number
  sentlenCv: number
  humanP10?: number
  humanP50?: number
  humanP90?: number
  budget?: SectionBudgetSpec
  issues: Array<{
    code:
      | 'section_over_budget'
      | 'low_sentence_cv'
      | 'top_heavy_sentence_length'
      | 'participial_ing_tail_stacking'
      | 'symmetric_paragraph_ending'
      | 'paragraph_template_repetition'
      | 'zero_agency_results'
      | 'multi_disclaimer_drift'
    severity: 'rework' | 'warn'
    label: string
    detail: string
  }>
}

// ---------- 基础分词与科学记数归一化 ----------

function translateSuperscripts(str: string): string {
  return str.replace(/[\u207b\u207a\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+/g, (seq) =>
    Array.from(seq)
      .map((ch) => SUPER_MAP[ch] ?? ch)
      .join(''),
  )
}

/** 归一化科学记数法与千分位，避免 2.3×10⁻⁵ 与 2.3e-5 误判为数字不一致 */
export function normaliseNumbers(text: string): string {
  let t = text.replace(/\u2212|\u2013|\u2014/g, '-')
  // 移除数字千分位逗号: 12,345 -> 12345
  t = t.replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
  // 带上标幂: 2.3 × 10⁻⁵ -> 2.3e-5
  t = t.replace(
    /(\d+(?:\.\d+)?)\s*[*×xX]\s*10\^?\s*([\u207b\u207a\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+|-?\d+)/g,
    (_, mant, exp) => `${mant}e${translateSuperscripts(exp)}`,
  )
  t = t.replace(
    /\b10\^?\s*([\u207b\u207a\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+|-?\d+)/g,
    (_, exp) => `1e${translateSuperscripts(exp)}`,
  )
  // 标准 e-notation 小写化并去除前导 +
  t = t.replace(/(\d+(?:\.\d+)?)[eE]\+?(-?\d+)/g, '$1e$2')
  return t
}

export function splitSentences(text: string): string[] {
  let t = text.trim()
  if (!t) return []
  ABBREV.forEach((abbr, idx) => {
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    t = t.replace(new RegExp(`\\b${escaped}\\.`, 'g'), `@@ABBR${idx}@@`)
  })
  // 人名首字母缩写如 J. Smith
  t = t.replace(/\b([A-Z])\.(?=\s*[A-Z])/g, '@@IN$1@@')
  const parts = t.split(/(?<=[.!?])["')\]]*\s+/)
  const out: string[] = []
  for (let p of parts) {
    p = p.replace(/@@ABBR(\d+)@@/g, (_, n) => `${ABBREV[Number(n)]}.`)
    p = p.replace(/@@IN([A-Z])@@/g, '$1.')
    p = p.replace(/\s+/g, ' ').trim()
    if (p && /[A-Za-z]{2}/.test(p)) out.push(p)
  }
  return out
}

export function tokenizeWords(text: string): string[] {
  return (
    text.match(/[A-Za-z][A-Za-z0-9'\u2019-]*|\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?/g) ?? []
  )
}

function percentile(values: number[], q: number): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const k = (s.length - 1) * q
  const lo = Math.floor(k)
  const hi = Math.min(lo + 1, s.length - 1)
  return Number((s[lo] + (s[hi] - s[lo]) * (k - lo)).toFixed(1))
}

function sentenceStats(lengths: number[]) {
  const n = lengths.length
  if (!n) {
    return { n: 0, mean: 0, sd: 0, cv: 0, p50: 0, p90: 0, pctUnder12: 0, pctOver35: 0 }
  }
  const mean = lengths.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  return {
    n,
    mean: Number(mean.toFixed(1)),
    sd: Number(sd.toFixed(1)),
    cv: mean > 0 ? Number((sd / mean).toFixed(2)) : 0,
    p50: percentile(lengths, 0.5),
    p90: percentile(lengths, 0.9),
    pctUnder12: Number(((100 * lengths.filter((x) => x < 12).length) / n).toFixed(1)),
    pctOver35: Number(((100 * lengths.filter((x) => x > 35).length) / n).toFixed(1)),
  }
}

// ---------- 英文润色 / 精缩前后确定性保真审计 (fidelity_diff.py) ----------

function expandCitSpec(spec: string): string[] {
  const tokens: string[] = []
  for (const part of spec.split(/[,;]/)) {
    const p = part.trim()
    if (!p) continue
    const range = p.match(/^(\d+)\s*[-\u2013]\s*(\d+)$/)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      if (b >= a && b - a <= 40) {
        for (let i = a; i <= b; i++) tokens.push(String(i))
        continue
      }
    }
    if (/^\d+$/.test(p)) tokens.push(p)
  }
  return tokens
}

function extractCitations(text: string): { cits: Set<string>; stripped: string } {
  const cits = new Set<string>()
  let stripped = text.replace(BRACKET_CIT_RE, (_, spec: string) => {
    for (const n of expandCitSpec(spec)) cits.add(n)
    return ' '
  })
  stripped = stripped.replace(PAREN_CIT_STRICT_RE, (_, spec: string) => {
    for (const n of expandCitSpec(spec)) cits.add(n)
    return ' '
  })
  return { cits, stripped }
}

function canonicalNum(raw: string): string {
  const s = raw.trim()
  if (/e/i.test(s)) {
    const n = Number(s)
    if (!Number.isNaN(n)) return n.toExponential(3)
  }
  if (s.endsWith('%')) {
    const n = Number(s.slice(0, -1))
    if (!Number.isNaN(n)) return `${n}%`
  }
  const n = Number(s)
  if (!Number.isNaN(n) && !/^0\d/.test(s)) return String(n)
  return s
}

function extractEnNumbers(text: string): string[] {
  const norm = normaliseNumbers(text)
  const { stripped } = extractCitations(norm)
  const matches = stripped.match(/(?<![A-Za-z0-9_])-?\d+(?:\.\d+)?(?:e-?\d+)?%?(?![A-Za-z0-9_])/gi) ?? []
  return matches.map(canonicalNum)
}

function multisetDiff(expected: string[], actual: string[]): string[] {
  const counts = new Map<string, number>()
  for (const x of actual) counts.set(x, (counts.get(x) ?? 0) + 1)
  const missing: string[] = []
  for (const x of expected) {
    const c = counts.get(x) ?? 0
    if (c > 0) counts.set(x, c - 1)
    else missing.push(x)
  }
  return Array.from(new Set(missing))
}

function countPhraseHits(text: string, list: string[]): Map<string, number> {
  const low = text.toLowerCase()
  const res = new Map<string, number>()
  for (const phrase of list) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const n = (low.match(new RegExp(`\\b${escaped}\\b`, 'g')) ?? []).length
    if (n > 0) res.set(phrase, n)
  }
  return res
}

function extractIdentifiers(text: string): Set<string> {
  const ids = new Set<string>()
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{2,7}\b/g)) {
    if (!IDENT_WHITELIST.has(m[0])) ids.add(m[0])
  }
  return ids
}

/** 对照源英文与润色/精缩后英文，给出零幻想机械差异门禁结果 */
export function auditEnglishPolish(sourceEn: string, polishedEn: string): FidelityDiffReport {
  const srcWords = tokenizeWords(sourceEn).length
  const dstWords = tokenizeWords(polishedEn).length
  const deltaPct = srcWords > 0 ? Math.round(((dstWords - srcWords) / srcWords) * 100) : 0

  const hardFlags: FidelityFlag[] = []
  const softWarnings: FidelityFlag[] = []

  // 1. 引用编号核对
  const srcCit = extractCitations(sourceEn).cits
  const dstCit = extractCitations(polishedEn).cits
  const missingCits = Array.from(srcCit).filter((c) => !dstCit.has(c))
  const addedCits = Array.from(dstCit).filter((c) => !srcCit.has(c))
  if (missingCits.length) {
    hardFlags.push({
      code: 'missing_citation',
      severity: 'hard',
      label: '丢失文献引用编号',
      detail: `原文引用 [${missingCits.join(', ')}] 在新版本中丢失`,
    })
  }
  if (addedCits.length) {
    hardFlags.push({
      code: 'added_citation',
      severity: 'hard',
      label: '新增未授权引用编号',
      detail: `新版本新增引用 [${addedCits.join(', ')}]`,
    })
  }

  // 2. 数值 / 科学记数核对
  const srcNums = extractEnNumbers(sourceEn)
  const dstNums = extractEnNumbers(polishedEn)
  const missingNums = multisetDiff(srcNums, dstNums)
  const addedNums = multisetDiff(dstNums, srcNums)
  if (missingNums.length) {
    hardFlags.push({
      code: 'missing_number',
      severity: 'hard',
      label: '丢失关键数值',
      detail: `缺失数值: ${missingNums.slice(0, 6).join(', ')}`,
    })
  }
  if (addedNums.length) {
    hardFlags.push({
      code: 'added_number',
      severity: 'hard',
      label: '新增未在原文出现的数字',
      detail: `新增数值: ${addedNums.slice(0, 6).join(', ')}`,
    })
  }

  // 3. 可复现参数与方法操作性细节核对
  const srcRepro = Array.from(new Set((sourceEn.match(REPRO_PARAM_RE) ?? []).map((x) => x.trim())))
  const dstReproLow = polishedEn.toLowerCase()
  const droppedRepro = srcRepro.filter((p) => !dstReproLow.includes(p.toLowerCase()))
  const srcOps = Array.from(new Set((sourceEn.match(OPERATIONAL_SPAN_RE) ?? []).map((x) => x.trim())))
  const droppedOps = srcOps.filter((p) => !dstReproLow.includes(p.toLowerCase()))
  const allDroppedParams = [...droppedRepro, ...droppedOps]
  if (allDroppedParams.length) {
    hardFlags.push({
      code: 'dropped_repro_param',
      severity: 'hard',
      label: '丢失可复现参数/算法细节',
      detail: allDroppedParams.slice(0, 4).join('; '),
    })
  }

  // 4. 否定词核对
  const srcNeg = countPhraseHits(sourceEn, NEGATION_WORDS)
  const dstNeg = countPhraseHits(polishedEn, NEGATION_WORDS)
  const srcNegTotal = Array.from(srcNeg.values()).reduce((a, b) => a + b, 0)
  const dstNegTotal = Array.from(dstNeg.values()).reduce((a, b) => a + b, 0)
  if (srcNegTotal !== dstNegTotal) {
    hardFlags.push({
      code: 'negation_flipped',
      severity: 'hard',
      label: '否定限定词数量变化',
      detail: `原文否定词 ${srcNegTotal} 处，新版 ${dstNegTotal} 处，请复核是否反转语义`,
    })
  }

  // 5. 专有基因/工具/队列标识核对
  const srcIds = extractIdentifiers(sourceEn)
  const dstIds = extractIdentifiers(polishedEn)
  const missingIds = Array.from(srcIds).filter((id) => !dstIds.has(id))
  if (missingIds.length) {
    hardFlags.push({
      code: 'missing_identifier',
      severity: 'hard',
      label: '丢失英文缩写/基因标识',
      detail: missingIds.slice(0, 6).join(', '),
    })
  }

  // 6. 证据等级软告警：关联→因果升级 / 限定词丢失 / 词数膨胀
  const srcCausal = countPhraseHits(sourceEn, CAUSAL_PATTERNS)
  const dstCausal = countPhraseHits(polishedEn, CAUSAL_PATTERNS)
  const addedCausal: string[] = []
  for (const [k, cnt] of dstCausal.entries()) {
    if (cnt > (srcCausal.get(k) ?? 0)) addedCausal.push(k)
  }
  if (addedCausal.length) {
    softWarnings.push({
      code: 'added_causal',
      severity: 'warn',
      label: '新增因果词（警惕关联升格因果）',
      detail: `新增: ${addedCausal.join(', ')}`,
    })
  }

  const srcQual = countPhraseHits(sourceEn, QUALIFIER_PATTERNS)
  const dstQual = countPhraseHits(polishedEn, QUALIFIER_PATTERNS)
  const droppedQual: string[] = []
  for (const [k, cnt] of srcQual.entries()) {
    if ((dstQual.get(k) ?? 0) < cnt) droppedQual.push(k)
  }
  if (droppedQual.length) {
    softWarnings.push({
      code: 'dropped_qualifier',
      severity: 'warn',
      label: '弱化限定词丢失',
      detail: `原句审慎词减少: ${droppedQual.join(', ')}`,
    })
  }

  if (dstWords > srcWords * 1.15 && dstWords - srcWords >= 10) {
    softWarnings.push({
      code: 'word_bloat',
      severity: 'warn',
      label: `篇幅膨胀 +${deltaPct}%`,
      detail: `词数由 ${srcWords} 增至 ${dstWords}，建议纯减法删去空洞连接词`,
    })
  }

  return {
    ok: hardFlags.length === 0,
    hardFlags,
    softWarnings,
    sourceWords: srcWords,
    targetWords: dstWords,
    wordDeltaPct: deltaPct,
  }
}

// ---------- 中译英确定性锚点校验 ----------

const ENGLISH_SMALL_WORDS: Record<string, string[]> = {
  '1': ['one', 'single', 'first'],
  '2': ['two', 'both', 'dual', 'double', 'two-fold', 'second'],
  '3': ['three', 'triple', 'three-fold', 'third'],
  '4': ['four', 'quadruple', 'four-fold', 'fourth'],
  '5': ['five', 'five-fold', 'fifth'],
  '6': ['six', 'six-fold', 'sixth'],
  '7': ['seven', 'seventh'],
  '8': ['eight', 'eighth'],
  '9': ['nine', 'ninth'],
  '10': ['ten', 'tenth'],
  '11': ['eleven'],
  '12': ['twelve'],
}

/** 核查中文源文中的强数值锚点、引用标号与英文基因/工具缩写是否在译文中丢失 */
export function auditZhToEnFidelity(zh: string, en: string): ZhEnFidelityReport {
  const issues: ZhEnFidelityIssue[] = []
  const zhTrim = zh.trim()
  const enTrim = en.trim()
  if (!zhTrim || !enTrim) return { ok: true, issues }

  // 1. 译文不得残留中文字符
  const cjk = enTrim.match(/[\u4e00-\u9fff]+/g)
  if (cjk?.length) {
    issues.push({
      code: 'unexpected_zh',
      label: '英文译文残留中文字符',
      tokens: cjk.slice(0, 4),
    })
  }

  // 2. 文献引用编号 [1] / [1-3]
  const zhCits = extractCitations(zhTrim).cits
  const enCits = extractCitations(enTrim).cits
  const missingCits = Array.from(zhCits).filter((c) => !enCits.has(c))
  if (missingCits.length) {
    issues.push({
      code: 'missing_citation',
      label: '译文丢失中文文献序号',
      tokens: missingCits.map((c) => `[${c}]`),
    })
  }

  // 3. 强数值锚点（小数、百分数、科学记数、>=13 整数，以及允许 1-12 写成英文数词）
  const zhCitStripped = extractCitations(normaliseNumbers(zhTrim)).stripped
  const rawZhNums =
    zhCitStripped.match(/(?<![A-Za-z0-9_])-?\d+(?:\.\d+)?(?:e-?\d+)?%?(?![A-Za-z0-9_])/gi) ?? []
  const enNumsSet = new Set(extractEnNumbers(enTrim))
  const enLow = enTrim.toLowerCase()

  const missingNums: string[] = []
  for (const raw of rawZhNums) {
    const can = canonicalNum(raw)
    if (enNumsSet.has(can)) continue
    // 若中文中是类似 1-12 的简单小整数（无小数点/百分号/科学记数），允许英文译为 two/three 等英文词
    if (/^\d+$/.test(can) && Number(can) >= 1 && Number(can) <= 12) {
      const alts = ENGLISH_SMALL_WORDS[can] ?? []
      if (alts.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(enLow))) continue
      // 跳过孤立的“1”、“2”序号列举误报（如 1) ...），仅严格检查多位数/小数/百分比
      if (Number(can) <= 2) continue
    }
    missingNums.push(can)
  }
  if (missingNums.length) {
    issues.push({
      code: 'missing_number',
      label: '数值锚点缺失/不一致',
      tokens: Array.from(new Set(missingNums)).slice(0, 6),
    })
  }

  // 4. 中文源文中自带的英文专有缩写/基因名（如 TCGA / TP53 / AUROC / UMAP）
  const zhAcronyms = Array.from(extractIdentifiers(zhTrim)).filter(
    // 若在中文中本身是大写英文缩写，英文中通常至少原样保留或作为前缀保留
    (id) => !['FIG', 'TAB', 'RNA', 'DNA', 'PCR'].includes(id),
  )
  const missingAcronyms = zhAcronyms.filter((id) => !new RegExp(`\\b${id}`, 'i').test(enTrim))
  if (missingAcronyms.length) {
    issues.push({
      code: 'missing_term',
      label: '英文基因/工具标识丢失',
      tokens: missingAcronyms.slice(0, 5),
    })
  }

  return {
    ok: issues.length === 0,
    issues,
  }
}

// ---------- De-AI 与顶刊文风微观体检 (style_metrics.py) ----------

function lookupSubstitutes(terms: string[]): Array<{ target: string; replacements: string[] }> {
  const out: Array<{ target: string; replacements: string[] }> = []
  const seen = new Set<string>()
  for (const term of terms) {
    const low = term.toLowerCase()
    for (const sub of skillBundle.humanSubstitutes) {
      const key = sub.target.toLowerCase()
      if (!seen.has(key) && (key.includes(low) || low.includes(key.split(' ')[0]))) {
        seen.add(key)
        out.push({
          target: sub.target,
          replacements: sub.substitutes.map((s) => s.text).slice(0, 4),
        })
      }
    }
  }
  return out
}

function detectOpener(firstSent: string): { type: OpenerType; word: string } {
  const trimmed = firstSent.trim()
  const firstWord = (trimmed.match(/^([A-Za-z]+)/)?.[1] ?? '').toLowerCase()
  if (/^(?:However|In contrast|By contrast|Whereas|Although|Conversely|Instead)\b/.test(trimmed)) {
    return { type: 'contrast', word: firstWord }
  }
  if (/^To\s+\w+/.test(trimmed)) return { type: 'to_infinitive', word: firstWord }
  if (/^(?:We|Using)\b/.test(trimmed)) return { type: 'we_using', word: firstWord }
  if (/^(?:Across|In (?:total|summary|contrast)|Among|\d|The \w+ (?:showed|revealed|comprised|contained|differed))/.test(trimmed)) {
    return { type: 'result_data', word: firstWord }
  }
  return { type: 'other', word: firstWord }
}

/** 对单段英文执行 De-AI 病灶检测与可读性/作者声音量化 */
export function analyzeParagraphStyle(en: string, scene: Scene): ParagraphStyleReport {
  const text = en.trim()
  const sentences = splitSentences(text)
  const sentLens = sentences.map((s) => tokenizeWords(s).length).filter((n) => n > 0)
  const words = tokenizeWords(text)
  const nw = Math.max(words.length, 1)
  const stats = sentenceStats(sentLens)

  const per1k = (n: number) => Number(((1000 * n) / nw).toFixed(1))

  const nomMatches = text.match(NOMINAL_TOKEN_RE) ?? []
  const passiveMatches = text.match(PASSIVE_RE) ?? []
  const fpMatches = text.match(/\b(?:we|our|ours|us)\b/gi) ?? []
  const anaphoraMatches = text.match(VOICE_ABSTRACT_ANAPHORA_RE) ?? []
  const specificMatches = text.match(VOICE_SPECIFIC_RE) ?? []

  const nominalPer1k = per1k(nomMatches.length)
  const passivePer1k = per1k(passiveMatches.length)
  const firstPersonPer1k = per1k(fpMatches.length)
  const abstractionIndex = Number(((anaphoraMatches.length * 1000) / nw + nominalPer1k / 10).toFixed(1))
  const specificityPerSent = Number((specificMatches.length / Math.max(sentences.length, 1)).toFixed(2))

  let hedgeSents = 0
  for (const s of sentences) {
    const hCount = (s.match(VOICE_HEDGE_RE) ?? []).length
    const hasDis = VOICE_DISCLAIMER_RE.test(s)
    if (hCount >= 2 || (hCount >= 1 && hasDis)) hedgeSents++
  }
  const overHedgingDensity = Number((hedgeSents / Math.max(sentences.length, 1)).toFixed(2))

  const opener = sentences[0] ? detectOpener(sentences[0]) : { type: 'other' as OpenerType, word: '' }
  const lastSent = sentences[sentences.length - 1] ?? ''
  const trailingSents = sentences.slice(-2)
  const hasFinalIngTail = Boolean(lastSent && PARTICIPIAL_TAIL_TEST_RE.test(lastSent))
  const hasUpliftEnding = trailingSents.some((s) => UPLIFT_END_RE.test(s) && !/\d/.test(s))
  const hasTailDisclaimer = Boolean(
    TAIL_DISCLAIMER_RE.test(text) ||
      (scene !== 'methods' && trailingSents.some((s) => VOICE_DISCLAIMER_RE.test(s))),
  )

  const flags: StyleFlag[] = []
  const low = text.toLowerCase()

  // 1. AI 词簇检测（区分 strict 近零 CNS AI 腔与 cluster 聚簇提示）
  const exemptSet = new Set(skillBundle.aiExempt.map((x) => x.toLowerCase()))
  const matchedStrict: string[] = []
  const matchedCluster: string[] = []
  for (const entry of skillBundle.aiLexicon) {
    if (exemptSet.has(entry.term)) continue
    const escaped = entry.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`, 'i')
    if (re.test(low)) {
      if (entry.tier === 'strict') matchedStrict.push(entry.term)
      else matchedCluster.push(entry.term)
    }
  }
  if (matchedStrict.length > 0 || (words.length >= 45 && matchedStrict.length + matchedCluster.length >= 2)) {
    const allHits = Array.from(new Set([...matchedStrict, ...matchedCluster]))
    const subs = lookupSubstitutes(allHits)
    flags.push({
      code: 'ai_lexicon_cluster',
      severity: 'rework',
      label: `AI 高偏倚词 (${allHits.slice(0, 3).join(', ')})`,
      detail: `命中 ${allHits.length} 项 CNS 语料低频 AI 倾向词（如 ${allHits.slice(0, 4).join(' / ')}）`,
      reworkHint: `删除或平实替换段内 AI 倾向词（${allHits.join(', ')}）${
        subs.length ? `；建议参考人写替换：${subs.map((s) => `${s.target} → ${s.replacements.join('/')}`).join('；')}` : ''
      }，保持全部数值与实验事实不变。`,
      matches: allHits,
      substitutes: subs,
    })
  }

  // 2. 伴随分词长尾巴 stacking
  const partTails = text.match(PARTICIPIAL_TAIL_RE) ?? []
  if (partTails.length >= 2) {
    flags.push({
      code: 'participial_ing_tail_stacking',
      severity: 'rework',
      label: `伴随分词尾巴堆叠 (${partTails.length} 处)`,
      detail: '单段出现 >=2 次 `, confirming/highlighting that...` 伴随结构，观察与解释粘连',
      reworkHint: '删除 `, confirming/highlighting/indicating that ...` 类伴随分词尾巴，改为简洁独立句，保留核心主句事实。',
    })
  } else if (hasFinalIngTail && scene === 'results') {
    flags.push({
      code: 'participial_ing_tail_stacking',
      severity: 'info',
      label: '段末伴随 `-ing that` 收尾',
      detail: 'Results 段落末尾含伴随分词解释从句（CNS 基线约 1.6%），连续多段出现时建议拆独立句',
      reworkHint: '若该段同时存在冗余解释，可将段尾 `, confirming/highlighting that ...` 拆分为紧接在数据句后的短句或精简删去。',
    })
  }

  // 3. 超过 32 词的多重从句/伴随长句
  const stuffedSents: string[] = []
  for (const s of sentences) {
    const wc = tokenizeWords(s).length
    if (wc <= 32) continue
    const hasPartTail = PARTICIPIAL_TAIL_TEST_RE.test(s)
    const subMatches = s.match(SUBORDINATE_CLAUSE_RE) ?? []
    if (hasPartTail || subMatches.length >= 3) {
      stuffedSents.push(`${wc}w`)
    }
  }
  if (stuffedSents.length > 0) {
    flags.push({
      code: 'clause_stuffed_long',
      severity: 'rework',
      label: `三层长句超限 (${stuffedSents.join('/')})`,
      detail: `存在 ${stuffedSents.length} 句超过 32 词且嵌套多个从句或伴随分词尾巴`,
      reworkHint: '将超过 32 词的多层长句拆分为两句（观察结果与解释各自独立），删去空洞修饰，维持清晰节奏。',
    })
  }

  // 4. 代码变量名 / 编程常量泄露（Methods 允许出现 R/Python 函数名时降级为 warn，Results/Discussion 标 rework）
  const codeLeaks = Array.from(new Set(text.match(CODE_LEAK_RE) ?? []))
  if (codeLeaks.length > 0) {
    const isMethods = scene === 'methods'
    flags.push({
      code: 'code_identifier_leak',
      severity: isMethods ? 'warn' : 'rework',
      label: `代码标识符直出 (${codeLeaks.slice(0, 2).join(', ')})`,
      detail: `正文出现原始代码变量/布尔值/函数名: ${codeLeaks.slice(0, 4).join(', ')}`,
      reworkHint: `将代码变量或编程参数 (${codeLeaks.join(', ')}) 转述为标准方法学英文散文（例如说明所执行的统计过滤标准与参数阈值，不直接把变量名作主语）。`,
      matches: codeLeaks,
    })
  }

  // 5. 非 Limitations 段反复自我免责
  if (hasTailDisclaimer && (scene === 'results' || scene === 'introduction')) {
    flags.push({
      code: 'repetitive_tail_disclaimer',
      severity: 'rework',
      label: '非 Limitations 段尾防御性免责',
      detail: '在 Results/Intro 段尾插入防御性审慎声明，建议统一收拢至 Discussion Limitations',
      reworkHint: '删除段尾空泛防御性免责宣言（如 should be interpreted with caution / cannot establish...），用平实陈述句直接交代实际观察结果及边界即可。',
    })
  }

  // 6. Author et al. 人名堆砌
  const authorCalls = text.match(AUTHOR_CALL_RE) ?? []
  if (authorCalls.length >= 2) {
    flags.push({
      code: 'author_call_stacking',
      severity: 'warn',
      label: `人名列举堆叠 (${authorCalls.length} 句)`,
      detail: '同一段连续使用 `Author et al. showed/reported...`，建议按科学机制综合作主语',
      reworkHint: '将连续的 `Author et al. showed...` 改写为以生物学机制或临床现象作主语的综合性句式，文献编号置句末。',
    })
  }

  // 7. 名词化过重
  if (words.length >= 50 && nominalPer1k > 85) {
    flags.push({
      code: 'excessive_nominalization',
      severity: 'warn',
      label: `抽象名词化偏高 (${nominalPer1k}/1k)`,
      detail: '-tion/-ment/-ity 抽象名词超过 85/千词，读感发虚',
      reworkHint: '将抽象名词堆砌（如 performed evaluation / showed elevation of）还原为直接有限动词（evaluated / increased）。',
    })
  }

  // 8. 非讨论区段末升华 / 标题模板腔
  if (hasUpliftEnding && scene !== 'discussion' && scene !== 'conclusion') {
    flags.push({
      code: 'symmetric_paragraph_ending',
      severity: 'rework',
      label: '段末无数字“升华拔高”',
      detail: `在 ${scene} 段末使用 Collectively/Taken together + 无数字套话，顶刊正文仅允许在 Discussion 末段至多一次`,
      reworkHint: '删除段尾无新数据支撑的空洞升华句（Collectively/Taken together...），以具体数值或机制结果收尾。',
    })
  }

  if (SUBHEADING_CLICHE_RE.test(text)) {
    flags.push({
      code: 'subheading_template_cliche',
      severity: 'rework',
      label: '动名词模板标题腔',
      detail: '标题/首词命中 Unveiling/Decoding/Illuminating/Navigating 模板',
      reworkHint: '将 Unveiling/Decoding 等动名词模板改为直接陈述核心发现的结论性名词短语或主谓短句（如 X promotes Y）。',
    })
  }

  // 9. 其它机械卡点提示
  if (text.includes('\u2014')) {
    flags.push({
      code: 'em_dash_clause',
      severity: 'info',
      label: '正文含长破折号 (—)',
      detail: '医学 SCI 正文极少用长破折号插句，建议改用括号、逗号或独立分句',
      reworkHint: '将长破折号（—）插句改为逗号分隔定语、括号或独立短句。',
    })
  }

  if (SIG_NEAR_PCT_RE.test(text) || SIG_NEAR_SHARE_RE.test(text)) {
    flags.push({
      code: 'sig_misattached',
      severity: 'warn',
      label: '`significant` 疑似修饰占比/均值',
      detail: 'significant(ly) 仅用于经统计检验的组间差异/相关性/趋势，避免直接修饰单一比例或均值',
      reworkHint: '检查 significant(ly) 是否贴错对象：仅修饰经过统计检验的差异或关联，并紧随检验指标。',
    })
  }

  for (const s of sentences) {
    if (FLAG_COMPARATIVE_RE.test(s) && !FLAG_ANCHOR_RE.test(s)) {
      flags.push({
        code: 'unanchored_comparative',
        severity: 'info',
        label: '比较级缺同句参照物',
        detail: '含 higher/lower/greater/more/less 但同句缺少 than/versus/compared with',
        reworkHint: '为比较级（higher/lower 等）明确补齐同句对比参照组（compared with / than ...），或确认前文已有清晰对照。',
      })
      break
    }
  }

  // 连续 3 句同一首词开篇
  if (sentences.length >= 3) {
    let run = 1
    let prev = detectOpener(sentences[0]).word
    for (let i = 1; i < sentences.length; i++) {
      const cur = detectOpener(sentences[i]).word
      if (cur && cur === prev) {
        run++
        if (run >= 3) {
          flags.push({
            code: 'monotonous_openings',
            severity: 'info',
            label: `连续 3 句同词开篇 (“${cur}”)`,
            detail: '相邻句首词重复，建议交替采用结果数据主语、转折或精炼动宾切入',
            reworkHint: '调整句首主语结构，打破连续三句同一首词开头的单调节奏。',
          })
          break
        }
      } else {
        run = 1
        prev = cur
      }
    }
  }

  const reworkable = flags.some((f) => f.severity === 'rework')

  return {
    nWords: words.length,
    nSents: sentences.length,
    sentlenP50: stats.p50,
    sentlenCv: stats.cv,
    pctUnder12: stats.pctUnder12,
    pctOver35: stats.pctOver35,
    nominalPer1k,
    passivePer1k,
    firstPersonPer1k,
    abstractionIndex,
    specificityPerSent,
    overHedgingDensity,
    openerType: opener.type,
    openerWord: opener.word,
    hasFinalIngTail,
    hasUpliftEnding,
    hasTailDisclaimer,
    flags,
    reworkable,
  }
}

// ---------- 全节预算与跨段协同体检 ----------

export function getSectionBudgets(profile: PaperProfile): Partial<Record<Scene, SectionBudgetSpec>> {
  const isCell = profile === 'cell-omics'
  return {
    abstract: isCell ? { maxWords: 150, maxSents: 7 } : { maxWords: 230, maxSents: 9 },
    introduction: { maxWords: 450, maxParas: 4 },
    methods: { maxWords: 1950 },
    results: { maxWords: 1150, maxParas: 8 },
    discussion: { maxWords: 1050, maxParas: 6 },
    conclusion: { maxWords: 300, maxParas: 2 },
    figure_legends: { maxWords: 1600 },
  }
}

export function analyzeDocumentSections(
  paragraphs: Paragraph[],
  profile: PaperProfile,
): SectionHealthReport[] {
  const byScene = new Map<Scene, Paragraph[]>()
  for (const p of paragraphs) {
    if (!p.en.trim()) continue
    const arr = byScene.get(p.scene) ?? []
    arr.push(p)
    byScene.set(p.scene, arr)
  }

  const budgets = getSectionBudgets(profile)
  const reports: SectionHealthReport[] = []
  const order: Scene[] = [
    'abstract',
    'introduction',
    'methods',
    'results',
    'discussion',
    'conclusion',
    'figure_legends',
  ]

  for (const scene of order) {
    const paras = byScene.get(scene)
    if (!paras?.length) continue

    const allLens: number[] = []
    let nWords = 0
    const styles: ParagraphStyleReport[] = []
    for (const p of paras) {
      const s = analyzeParagraphStyle(p.en, scene)
      styles.push(s)
      nWords += s.nWords
      for (const sent of splitSentences(p.en)) {
        const l = tokenizeWords(sent).length
        if (l > 0) allLens.push(l)
      }
    }

    const stats = sentenceStats(allLens)
    const sentRef =
      (skillBundle.humanSentlen as Record<string, { p10: number; p50: number; p90: number }>)[
        scene === 'conclusion' ? 'discussion' : scene
      ]
    const budget = budgets[scene]
    const issues: SectionHealthReport['issues'] = []

    if (budget) {
      const overWords = nWords > budget.maxWords
      const overParas = budget.maxParas ? paras.length > budget.maxParas : false
      const overSents = budget.maxSents ? stats.n > budget.maxSents : false
      if (overWords || overParas || overSents) {
        issues.push({
          code: 'section_over_budget',
          severity: 'warn',
          label: '本节超出顶刊配额预算',
          detail: `当前 ${nWords} 词 / ${paras.length} 段 / ${stats.n} 句；目标参考 ≤${budget.maxWords} 词${
            budget.maxParas ? ` / ≤${budget.maxParas} 段` : ''
          }${budget.maxSents ? ` / ≤${budget.maxSents} 句` : ''}`,
        })
      }
    }

    if (stats.n >= 12 && stats.cv < 0.36) {
      issues.push({
        code: 'low_sentence_cv',
        severity: 'warn',
        label: `句长变异系数过低 (CV=${stats.cv})`,
        detail: '全节长短句单调均一（参考 CNS >=0.38），建议穿插 <12 词主题定调短句与 18-25 词证据句',
      })
    }

    if (sentRef && stats.n >= 5 && stats.p50 > sentRef.p90 * 1.1) {
      issues.push({
        code: 'top_heavy_sentence_length',
        severity: 'warn',
        label: `句长中位数偏长 (p50=${stats.p50})`,
        detail: `超出顶刊同节 p90 (${sentRef.p90}) 的 10% 以上，建议拆分长难句`,
      })
    }

    // 连续段落 -ing 尾巴或相同开篇模式
    let ingRun = 0
    let upliftRun = 0
    let openerRun = 1
    let disclaimerCount = 0
    for (let i = 0; i < styles.length; i++) {
      ingRun = styles[i].hasFinalIngTail ? ingRun + 1 : 0
      upliftRun = styles[i].hasUpliftEnding ? upliftRun + 1 : 0
      if (styles[i].hasTailDisclaimer) disclaimerCount++
      if (ingRun === 2) {
        issues.push({
          code: 'participial_ing_tail_stacking',
          severity: 'rework',
          label: '连续多段末尾伴随分词 `-ing that`',
          detail: '相邻段落都在句尾挂接 `, confirming/highlighting that...`，高度触发 AI 腔特征',
        })
      }
      if (upliftRun === 2) {
        issues.push({
          code: 'symmetric_paragraph_ending',
          severity: 'rework',
          label: '连续多段末尾使用无数字升华套话',
          detail: '多段重复 `Collectively/Taken together, these findings...`',
        })
      }
      if (i > 0) {
        if (styles[i].openerType !== 'other' && styles[i].openerType === styles[i - 1].openerType) {
          openerRun++
          if (openerRun === 3) {
            issues.push({
              code: 'paragraph_template_repetition',
              severity: 'warn',
              label: `连续 3 段采用同型开场 (${styles[i].openerType})`,
              detail: '相邻段落首句开场模板雷同，建议交错使用结果数字主语或机制转折切入',
            })
          }
        } else {
          openerRun = 1
        }
      }
    }

    if (disclaimerCount >= 2 && scene === 'results') {
      issues.push({
        code: 'multi_disclaimer_drift',
        severity: 'warn',
        label: `Results 内多段 (${disclaimerCount}) 插入免责声明`,
        detail: '建议将方法边界集中放入 Methods 或 Discussion Limitations 一处',
      })
    }

    if (scene === 'results' && stats.n >= 20) {
      const weHits = paras.reduce(
        (acc, p) => acc + (p.en.match(/\b(?:we|our|ours|us)\b/gi) ?? []).length,
        0,
      )
      if (weHits === 0) {
        issues.push({
          code: 'zero_agency_results',
          severity: 'warn',
          label: 'Results 全节零 `we/our` 主动研究视角',
          detail: '人类顶刊 Results 通过 `To test..., we ...` / `We reasoned that...` 串联实验决策，避免通篇非人称被动语态',
        })
      }
    }

    reports.push({
      scene,
      nParas: paras.length,
      nWords,
      nSents: stats.n,
      sentlenP50: stats.p50,
      sentlenCv: stats.cv,
      humanP10: sentRef?.p10,
      humanP50: sentRef?.p50,
      humanP90: sentRef?.p90,
      budget,
      issues,
    })
  }

  return reports
}

// ---------- 同节跨段协调上下文构造 ----------

export interface SectionCoordContext {
  prevParaSummary?: string
  prevOpenerType?: OpenerType
  prevHadFinalIngTail?: boolean
  resultsToOpenerCount?: number
  alreadyHasDisclaimer?: boolean
  knownAcronyms?: string[]
}

export function buildSectionCoordContext(
  paragraphs: Paragraph[],
  currentIndex: number,
): SectionCoordContext {
  const cur = paragraphs[currentIndex]
  if (!cur) return {}

  const sameSectionPrev = paragraphs.slice(0, currentIndex).filter((p) => p.scene === cur.scene && p.en.trim())
  const prevImmediate = currentIndex > 0 ? paragraphs[currentIndex - 1] : null

  let resultsToOpenerCount = 0
  let alreadyHasDisclaimer = false
  const acronymSet = new Set<string>()

  for (const p of sameSectionPrev) {
    const firstSent = splitSentences(p.en)[0] ?? ''
    if (/^To\s+\w+/.test(firstSent)) resultsToOpenerCount++
    if (TAIL_DISCLAIMER_RE.test(p.en) || VOICE_DISCLAIMER_RE.test(p.en)) alreadyHasDisclaimer = true
    for (const m of p.en.matchAll(/\b[A-Z][A-Z0-9-]{2,8}\b/g)) {
      if (!IDENT_WHITELIST.has(m[0])) acronymSet.add(m[0])
    }
  }

  let prevOpenerType: OpenerType | undefined
  let prevHadFinalIngTail = false
  if (prevImmediate?.en.trim()) {
    const sents = splitSentences(prevImmediate.en)
    if (sents[0]) prevOpenerType = detectOpener(sents[0]).type
    const last = sents[sents.length - 1] ?? ''
    prevHadFinalIngTail = Boolean(last && PARTICIPIAL_TAIL_TEST_RE.test(last))
  }

  const prevEnBounded = prevImmediate?.en.trim() ? boundText(prevImmediate.en, 500) : undefined

  return {
    prevParaSummary: prevEnBounded,
    prevOpenerType,
    prevHadFinalIngTail,
    resultsToOpenerCount,
    alreadyHasDisclaimer,
    knownAcronyms: Array.from(acronymSet).slice(0, 12),
  }
}

// ---------- 作者视角注入槽 (author_prompts.py) ----------

export function suggestAuthorPrompts(en: string, scene: Scene): AuthorPromptSuggestion[] {
  const text = en.trim()
  if (!text) return []
  const suggestions: AuthorPromptSuggestion[] = []

  if (AP_CHOICE_RE.test(text) && (scene === 'methods' || scene === 'results' || scene === 'discussion')) {
    suggestions.push({
      id: 'choice',
      label: '补充方法决策依据',
      question: '这里选择了特定方法/对照/参数，当年实验设计时为何优先选它（而非其他替代方案）？',
      placeholder: '例：因临床组织样本量为 FFPE 微量，选用该方案以降低批次偏差（选填）',
    })
  }

  if (AP_EXPECT_RE.test(text) && (scene === 'results' || scene === 'discussion')) {
    suggestions.push({
      id: 'expect',
      label: '补充与预期反差',
      question: '该现象是否符合你们最初假设？若出乎意料或存在边界条件，可一句话点明：',
      placeholder: '例：与此前常见认知不同，该亚群仅在淋巴结转移灶内扩增（选填）',
    })
  }

  if (
    AP_STAT_RE.test(text) &&
    (scene === 'results' || scene === 'abstract') &&
    !/\d[\d,]*(?:\.\d+)?\s*(?:%|patients|samples|cells|mice)/i.test(text)
  ) {
    suggestions.push({
      id: 'stat',
      label: '补齐样本数或绝对效应量',
      question: '当前句包含统计检验词，是否需顺手补齐样本量 n、中位差值或具体阈值？',
      placeholder: '例：n = 48 例配对样本，AUC 从 0.72 提升至 0.86（选填）',
    })
  }

  if (AP_LIMIT_RE.test(text) && (scene === 'discussion' || scene === 'conclusion')) {
    suggestions.push({
      id: 'limit',
      label: '将空泛免责转为具体实验局限',
      question: '如提及局限性，请写明具体缺少哪一类实验或队列验证（避免只写 "需进一步研究"）：',
      placeholder: '例：缺少前瞻性多中心外部队列与体内功能敲除验证（选填）',
    })
  }

  return suggestions.slice(0, 2)
}
