/**
 * 学术论文翻译与高标准医学 SCI 润色 Prompt 构建器。
 * 融合 biomedical-polish Skill（R1–R6 作者声音、证据强度动词锁、De-AI 纯减法、
 * 体裁分节预算与跨段协调）同时保持对轻量化翻译模型及测试契约的向后兼容。
 */
import type { AiMode, PaperProfile, Scene, TranslateQuality } from '../types'
import { matchSkillPatterns } from './patternMatcher'
import type { SectionCoordContext, StyleFlag, ZhEnFidelityIssue } from './polishAudit'

export type { AiMode }

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GlossaryPair {
  zh: string
  en: string
}

export interface BuildArgs {
  mode: AiMode
  scene: Scene
  profile?: PaperProfile
  quality?: TranslateQuality
  zh?: string
  en?: string
  prevZh?: string
  prevEn?: string
  coord?: SectionCoordContext
  glossary?: GlossaryPair[]
  customPrompt?: string
  /** rework 模式下的机械体检红牌清单 */
  reworkFlags?: StyleFlag[]
  /** 中译英阶段发现的漏数/漏词问题 */
  fidelityIssues?: ZhEnFidelityIssue[]
  /** 作者视角注入槽传入的补充说明 */
  authorNote?: string
}

export const SCENE_LABELS: Record<Scene, string> = {
  abstract: 'Abstract / Summary (摘要)',
  introduction: 'Introduction (引言)',
  methods: 'Methods / STAR Methods (方法)',
  results: 'Results (结果)',
  discussion: 'Discussion (讨论)',
  conclusion: 'Conclusion (结论)',
  figure_legends: 'Figure Legends (图注)',
}

export const PROFILE_LABELS: Record<PaperProfile, string> = {
  'nature-omics': 'Nature 系 / 组学顶刊 (Nat Med / Nat Cancer / NC)',
  'cell-omics': 'Cell Press / STAR 规范 (Cell / Cancer Cell / CR)',
  'method-tool': '算法与计算工具 (Nat Methods / Nat Comput Sci)',
  'general-clinical': '临床队列与标志物 (JAMA / Lancet Oncol / Ann Oncol)',
}

export const QUALITY_LABELS: Record<TranslateQuality, string> = {
  fast: '快速直译（低冗余指令，适合局部初稿/本地小模型）',
  high: '高标准润色直译（译写一体 + 顶刊骨架与 De-AI 约束）',
  'two-pass': '双遍闭环精译（译后体检 + 红牌自动回炉纯减法）',
}

export const SCENE_HINTS: Record<Scene, string> = {
  abstract:
    'Writing Section: Abstract (structured or unstructured). Rules: Target ~180–230 words (Cell Summary <=150 words). Present tense for known facts, past tense for study methods and results. No figure citations or reference numbers unless required. Lead with clear disease/scientific premise and end with bounded clinical/biological significance—never self-praise novelty.',
  introduction:
    'Writing Section: Introduction. Rules: Target <=450 words total across 3–4 tight paragraphs (known biology -> unresolved gap -> "Here, we..." study overview). State known facts in present tense and unresolved gaps conservatively. Do not turn Introduction into a textbook review; pair every named knowledge gap with how the present work addresses it.',
  methods:
    'Writing Section: Methods. Rules: Predominantly past tense passive voice (except software/equations in present). Preserve EVERY statistical test, multiple-testing correction, reagent, concentration, cutoff, software version, sample size, and reproducibility parameter verbatim. Translate raw code variables, boolean flags (=TRUE/FALSE/NA), or function idioms into formal methodological English prose.',
  results:
    'Writing Section: Results. Rules: Past tense using crisp "we" active study decisions ("To test whether..., we...", "We observed...") interleaved with concise data-anchored sentences (<12w anchor sentence mixed with 18–25w evidence sentences). Keep observation and interpretation in separate sentences; avoid tacking ", confirming/highlighting that..." participial commentary tails onto complex sentences. Do not insert repeated defensive disclaimers or numberless uplift conclusions in Results paragraphs.',
  discussion:
    'Writing Section: Discussion. Rules: Converge on key mechanistic and clinical implications without repeating Methods or raw paragraphs word-for-word. Use conditional/evidence-calibrated verbs (suggests, is consistent with, may reflect) when interpreting mechanism beyond tested interventions. Group methodological boundaries cleanly into one prose paragraph (never empty "should be interpreted with caution" filler; explain concrete evidence range and missing validation). Limit overarching summary closings ("Collectively/Taken together...") to at most once.',
  conclusion:
    'Writing Section: Conclusion. Rules: Concise 1–2 paragraph synthesis anchored strictly to demonstrated findings and translational/mechanistic boundaries. Do not repeat raw Abstract figures verbatim or introduce untested mechanisms.',
  figure_legends:
    'Writing Section: Figure Legends. Rules: Open with an assertive declarative title phrase (never "Analysis of..." or "Unveiling/Decoding..."). For individual panels, state sample sizes (n), biological vs technical replicates, statistical test, exact error bar definition (mean +/- SD/SEM or median +/- IQR), and correction threshold clearly in past tense.',
}

const PROFILE_RULES: Record<PaperProfile, string> = {
  'nature-omics':
    'Target Journal Style: Nature-family Biomedical/Omics. Rhythm: Mix crisp <12-word topic sentences with 18–25-word quantitative evidence sentences (sentence p50 ~20–24 words). Subheadings should be assertive noun phrases stating the finding.',
  'cell-omics':
    'Target Journal Style: Cell Press / STAR Methods. Rhythm: Keep Summary concise (<=150 words; opening sentence states concrete biological fact without starting with "Here"). Keep Results transitions crisp; group study limitations into cohesive unnumbered prose.',
  'method-tool':
    'Target Journal Style: Computational Method / Bioinformatics Tool. Requirements: State algorithmic objective, inputs/outputs, regularization or loss mechanics accurately, and anchor performance gains to named benchmarks, sample sizes, and numeric metric deltas (avoid vague "superior/SOTA" boasts).',
  'general-clinical':
    'Target Journal Style: High-impact Clinical Oncology / Cohort Biomarker. Requirements: State cohort inclusion/exclusion, endpoints, multivariable adjustment covariates, and report HR/OR/AUC alongside exact 95% CIs and P values; label observational associations strictly as "associated with".',
}

export const BASE_RULES = `Absolute Fidelity & Academic Writing Rules (STRICTLY ENFORCED):
1. Do not fabricate, drop, round, or alter any number, percentage, unit, sample size (n), p-value, HR, OR, 95% CI, fold-change, gene/protein symbol, pathway name, or literature citation index [1]. Keep statistical symbols exact (HR、OR, FDR, AUC, 95% CI, log2FC).
2. Calibrate verb strength strictly to experimental evidence:
   - Association / observational / prognostic / correlation data -> use "associated with", "correlated with", "linked to", "enriched in", "harbored", "marked". NEVER upgrade correlation to causal "drives", "causes", "induces", or "leads to" unless physical perturbation/intervention (knockout/knockdown/rescue/drug treatment) is explicitly stated.
   - Computational inference (GSEA, pseudotime, CellChat, regulons) -> use "inferred", "predicted", "putative", "consistent with", "aligned along".
3. Do not write promotional hype or empty AI tropes: avoid "delve into", "pivotal/crucial role", "multifaceted", "intricate interplay", "testament to", "realm", "game changer", "unveiling", "decoding", "illuminating", "navigating", "groundbreaking", and numberless uplift filler ("Collectively, these findings underscore...").
4. Avoid multi-clause bloat (>32 words stuffed with nested clauses or ", confirming/highlighting/underscoring that..." participial tails). Prefer active, direct finite verbs over heavy "-tion/-ment/-ity" nominalization ("evaluated" instead of "performed an evaluation of").
5. Output ONLY the clean English academic text for this paragraph. Do not wrap in quotes, headings, bullet prefixes, or commentary unless already part of the source.`

const EVIDENCE_AND_VOICE_CORE = `Author Voice & Structural Craft (biomedical-polish standards):
- State real boundaries honestly and specifically instead of vague self-weakening clichés ("should be interpreted with caution"); pair established evidence scope with concrete next validation steps.
- When citing prior literature in Discussion/Introduction, synthesize by biological finding/mechanism rather than chaining repeated "Smith et al. showed... Lee et al. reported..." sentences.
- Keep sentences tight: separate observation sentences (exact data) from interpretation sentences (measured biological implication).`

export const POLISH_SYSTEM = `You are a senior Nature/Cell biomedical editor performing high-standard academic polishing (英文学术润色) on an existing English manuscript paragraph.
Preserve 100% of numbers, units, sample sizes, statistics (HR, OR, P, 95% CI), gene symbols, citations [1], and negation qualifiers.
Eliminate AI-flavored clichés ("delve", "pivotal role", "multifaceted", "intricate interplay", "unveiling", "underscoring"), break apart >32-word clause-stuffed sentences with stacked participial "-ing that" tails, unpack heavy nominalizations into direct verbs, and translate any leaked code variable names into standard methodological English prose without inflating length.
Output ONLY the revised English paragraph.`

export const COMPRESS_SYSTEM = `You are a senior Nature/Cell managing editor trimming a biomedical manuscript paragraph for strict word-budget discipline.
Perform pure-subtraction editing: tighten verbose prepositions, delete redundant transitional filler and repetitive caveats, unpack wordy nominalizations, and cut repetitive clause-stuffed tails—aiming for ~15–25% fewer words while preserving 100% of numbers, units, statistical metrics, gene/software names, citations, and nuanced qualifiers.
Output ONLY the tightened English paragraph.`

export const GRAMMAR_SYSTEM = `You are an expert scientific copyeditor performing minimal grammar, article, tense, preposition, and subject-verb agreement corrections on a biomedical manuscript paragraph.
Keep sentence structures, word count, terminology, statistics, and scientific nuance unchanged. Only fix errors or unidiomatic phrasing.
Output ONLY the corrected English paragraph.`

export const SIMPLIFY_SYSTEM = `You are a senior biomedical editor making a dense English paragraph clearer and easier to read for broad life-science reviewers.
Break overly long nested sentences into crisp direct statements with active verbs and clear topic progression while retaining every number, caveat, statistical metric, gene symbol, and citation intact.
Output ONLY the simplified English paragraph.`

export const REWORK_SYSTEM = `You are performing a targeted pure-subtraction De-AI and fidelity repair pass on a biomedical manuscript paragraph.
Fix ONLY the explicitly listed audit issues (removing flagged AI clichés, splitting >32-word stuffed sentences, deleting participial "-ing that" tails, converting leaked snake_case/boolean code identifiers into prose, or restoring dropped quantitative anchors) using the suggested human academic substitutes when helpful. Do NOT pad the text or fabricate any data.
Output ONLY the repaired English paragraph.`

function formatGlossaryBlock(glossary: GlossaryPair[] | undefined): string {
  if (!glossary?.length) return ''
  const lines = glossary.map((g) => `- ${g.zh} => ${g.en}`).join('\n')
  return `\n术语表（必须严格使用对应英文术语，不可随意替换）：\n${lines}`
}

function formatPatternBlock(args: BuildArgs): string {
  const quality = args.quality ?? 'high'
  if (quality === 'fast') return ''
  const profile = args.profile ?? 'nature-omics'
  const matches = matchSkillPatterns({
    scene: args.scene,
    profile,
    zh: args.zh,
    en: args.en,
    maxMatches: 2,
  })
  if (!matches.length) return ''

  const lines = matches.map((m) => {
    const col = m.collocations.length ? ` | Preferred phrasing: ${m.collocations.join(', ')}` : ''
    const tip = m.tip ? ` | Note: ${m.tip}` : ''
    return `- [${m.label}] Structural pattern (${m.status}): "${m.skeleton}"${col}${tip}`
  })
  return `\nMatched High-Impact Discourse Patterns (adapt only if semantically applicable, never copy placeholder symbols literally):\n${lines.join('\n')}`
}

function formatCoordBlock(coord: SectionCoordContext | undefined, scene: Scene, quality: TranslateQuality): string {
  if (!coord || quality === 'fast') return ''
  const hints: string[] = []
  if (coord.prevOpenerType && coord.prevOpenerType !== 'other') {
    const openerDesc: Record<string, string> = {
      contrast: 'a contrast word (However/In contrast)',
      to_infinitive: '"To ..., we..."',
      we_using: '"We/Using..."',
      result_data: 'a numeric/result noun phrase',
    }
    hints.push(`Avoid opening immediately with the exact same template as the prior paragraph (${openerDesc[coord.prevOpenerType] ?? coord.prevOpenerType}) unless natural contrast requires it.`)
  }
  if (coord.prevHadFinalIngTail) {
    hints.push('The previous paragraph already ended with a participial "-ing that" clause; end THIS paragraph cleanly with a finite fact or direct period.')
  }
  if (scene === 'results' && (coord.resultsToOpenerCount ?? 0) >= 2) {
    hints.push('Multiple earlier Results paragraphs already opened with "To ..., we..."; open directly with the biological subject or finding here.')
  }
  if (coord.alreadyHasDisclaimer && (scene === 'results' || scene === 'introduction')) {
    hints.push('A methodological caveat already appeared earlier in this section; do not repeat general cautionary disclaimers at paragraph end.')
  }
  if (coord.knownAcronyms?.length) {
    hints.push(`Abbreviations already used in this section (keep spelling/casing consistent): ${coord.knownAcronyms.join(', ')}`)
  }
  if (!hints.length) return ''
  return `\nCross-Paragraph Section Coordination:\n- ${hints.join('\n- ')}`
}

function formatContextBlock(prevZh?: string, prevEn?: string): string {
  if (!prevZh?.trim() && !prevEn?.trim()) return ''
  const parts: string[] = []
  if (prevZh?.trim()) parts.push(`前段中文仅供参考语境（不要翻译或输出）：\n${prevZh.trim()}`)
  if (prevEn?.trim()) parts.push(`前段英文仅供参考衔接与时态（不要翻译或输出）：\n${prevEn.trim()}`)
  return `\n${parts.join('\n\n')}`
}

export function buildMessages(args: BuildArgs): ChatMsg[] {
  const {
    mode,
    scene,
    profile = 'nature-omics',
    quality = 'high',
    zh = '',
    en = '',
    prevZh,
    prevEn,
    coord,
    glossary,
    customPrompt,
    reworkFlags = [],
    fidelityIssues = [],
    authorNote = '',
  } = args

  const sceneHint = SCENE_HINTS[scene]
  const profileRule = PROFILE_RULES[profile]
  const glossaryBlock = formatGlossaryBlock(glossary)
  const customBlock = customPrompt?.trim()
    ? `\n用户补充写作要求（注意：不覆盖以上数值/引用保真与禁用空洞 AI 词铁律）：\n${customPrompt.trim()}`
    : ''

  if (mode === 'translate') {
    const contextBlock = formatContextBlock(prevZh, prevEn)
    const coordBlock = formatCoordBlock(coord, scene, quality)
    const patternBlock = formatPatternBlock(args)

    const system =
      quality === 'fast'
        ? `You are a professional biomedical translator translating Chinese academic prose into publication-grade English (${sceneHint}).\n${BASE_RULES}${glossaryBlock}${contextBlock}${customBlock}`
        : `You are a senior biomedical scientist & Nature/Cell editor translating and simultaneously polishing Chinese academic prose into publication-grade English.\n${sceneHint}\n${profileRule}\n${BASE_RULES}\n${EVIDENCE_AND_VOICE_CORE}${patternBlock}${glossaryBlock}${coordBlock}${contextBlock}${customBlock}`

    // translate 模式 user 仅放待译中文正文（防止指令标签泄露到轻量翻译模型输出中）
    return [
      { role: 'system', content: system },
      { role: 'user', content: zh.trim() },
    ]
  }

  if (mode === 'rework') {
    const issueLines: string[] = []
    for (const f of fidelityIssues) {
      issueLines.push(`- [Fidelity Anchor] ${f.label}: ${f.tokens.join(', ')} (must match Chinese source exactly)`)
    }
    for (const flag of reworkFlags) {
      issueLines.push(`- [De-AI / Style: ${flag.label}] ${flag.reworkHint}`)
    }
    const sourceHint = zh.trim()
      ? `\nChinese reference (for verifying dropped numbers/terms ONLY—do not output Chinese):\n${zh.trim()}`
      : ''
    const issueBlock = issueLines.length
      ? `\nSpecific Audit Items to Repair (fix ONLY these via pure subtraction / concise rephrasing):\n${issueLines.join('\n')}`
      : '\nTrim any subtle AI clichés, stacked "-ing that" tails, or >32-word nested clauses via pure subtraction.'

    const system = `${REWORK_SYSTEM}\n${sceneHint}\n${profileRule}\n${BASE_RULES}${issueBlock}${glossaryBlock}${sourceHint}${customBlock}`
    return [
      { role: 'system', content: system },
      { role: 'user', content: en.trim() },
    ]
  }

  if (mode === 'authorInsert') {
    const system = `You are a senior biomedical editor integrating a brief author insight directly into the existing English paragraph.
${sceneHint}\n${profileRule}\n${BASE_RULES}
Rules for integration:
- Smoothly weave the author's methodological rationale, biological expectation, quantitative detail, or concrete limitation into the paragraph without breaking narrative flow.
- If the author's note is in Chinese, translate it naturally into matched academic English register (never leak Chinese characters).
- Retain 100% of existing numbers, citations, statistics, and qualifiers. Output ONLY the updated English paragraph.${glossaryBlock}${customBlock}`
    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content: `Existing English paragraph:\n${en.trim()}\n\nAuthor note to integrate cleanly:\n${authorNote.trim()}`,
      },
    ]
  }

  const headByMode: Record<Exclude<AiMode, 'translate' | 'rework' | 'authorInsert'>, string> = {
    polish: POLISH_SYSTEM,
    compress: COMPRESS_SYSTEM,
    grammar: GRAMMAR_SYSTEM,
    simplify: SIMPLIFY_SYSTEM,
  }

  const extra =
    mode === 'polish' || mode === 'compress'
      ? `\n${EVIDENCE_AND_VOICE_CORE}${formatPatternBlock(args)}${formatCoordBlock(coord, scene, 'high')}`
      : ''
  const zhAnchor =
    zh.trim() && (mode === 'polish' || mode === 'compress')
      ? `\n中文源文（仅作事实与术语对照，严禁输出中文）：\n${zh.trim()}`
      : ''

  const system = `${headByMode[mode]}\n${sceneHint}\n${profileRule}\n${BASE_RULES}${extra}${glossaryBlock}${zhAnchor}${customBlock}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: en.trim() },
  ]
}
