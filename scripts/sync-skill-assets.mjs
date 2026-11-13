#!/usr/bin/env node
/**
 * 从本地 biomedical-polish Skill 目录抽取精简、高价值的结构化写作资产，
 * 生成前端可直接打包的轻量 JSON（src/data/biomedicalSkill.json）。
 *
 * 用法：node scripts/sync-skill-assets.mjs
 * 可通过环境变量 BIOMEDICAL_POLISH_SKILL_DIR 覆盖源 Skill 路径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SKILL_DIR =
  process.env.BIOMEDICAL_POLISH_SKILL_DIR || 'C:\\Users\\Admin\\.agents\\skills\\biomedical-polish'
const OUT_FILE = path.join(ROOT, 'src', 'data', 'biomedicalSkill.json')

const AI_BASELINE_EXEMPT = [
  'robust',
  'landscape',
  'comprehensive',
  'associated with',
  'furthermore',
  'moreover',
  'notably',
  'importantly',
  'interestingly',
  'overall',
  'collectively',
  'taken together',
]

// 统计脚本在语料对比中混入的功能词/OCR 碎片或纯常规实验词，予以剔除以免前端误报
const NOISE_STOP_TERMS = new Set([
  'and and',
  'in of',
  'with and',
  'of which',
  'of samples',
  'of participants',
  'the samples',
  'the observed',
  'the limited',
  'the context',
  'the findings',
  'the relationship',
  'the relationship between',
  'the interpretation',
  'the extent',
  'the biological',
  'the present',
  'present study',
  'and this',
  'and these',
  'and further',
  'and samples',
  'and therapeutic',
  'across the',
  'among the',
  'samples and',
  'nature',
  'nature of',
  'digital',
  'please',
  'total of',
  'a total of',
  'a potential',
  'a correlation',
  'pattern',
  'pattern of',
  'extent',
  'relative to',
  'excluded',
  'associations',
  'associated with the',
  'comparisons',
  'replicates',
  'statistics',
  'numerical',
  'yielded',
  'remaining',
  'indicate',
  'indicate a',
  'reflect',
  'relation',
  'relation to',
  'in relation',
  'in relation to',
  'relationship',
  'relationship between',
  'relevance',
  'relevant to',
  'elevation',
  'downregulated',
  'downregulation',
  'downregulation of',
  'upregulation of',
  'expression was',
  'expression patterns',
  'independent experiments',
  'samples were analyzed',
  'participants were',
  'significant difference',
  'was significantly',
  'was observed',
  'was observed in',
  'was assessed',
  'were analyzed',
  'were identified',
  'were performed',
  'examined in',
  'examined the',
  'reported in',
  'been reported',
  'included in',
  'included in the',
  'observed in',
  'yet the',
  'alongside',
  'involving',
  'magnitude',
  'needed to',
  'suggest a',
  'suggesting a',
  'contribute to the',
  'implicated in the',
  'in the context',
  'in the present',
])

const STRICT_EXTRA_TROPES = [
  'delve into',
  'game changer',
  'shed light on',
  'shedding light on',
  'play a pivotal role',
  'play a crucial role',
]

const CLUSTER_EXTRA_TROPES = [
  'pivotal',
  'crucial role',
  'intricate',
  'intricate interplay',
  'interplay',
  'underscore',
  'underscores',
  'underscoring',
  'leverage',
  'leveraging',
  'contingent upon',
  'encompassing',
  'myriad',
  'biologically plausible',
  'should not be interpreted as',
  'did not achieve statistical significance',
]

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(SKILL_DIR, relPath), 'utf-8'))
}

function readJsonl(relPath) {
  const full = path.join(SKILL_DIR, relPath)
  const lines = fs.readFileSync(full, 'utf-8').split(/\r?\n/)
  const out = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    out.push(JSON.parse(trimmed))
  }
  return out
}

function main() {
  if (!fs.existsSync(SKILL_DIR)) {
    console.error(`[sync-skill-assets] 找不到 Skill 目录: ${SKILL_DIR}`)
    process.exit(1)
  }

  const moveCatalog = readJson('patterns/move_catalog.json')
  const downgrades = readJson('patterns/move_downgrades_v23.json')?.moves || {}
  const cnsWordfreq = readJson('patterns/corpus_stats/cns_wordfreq.json')
  const tailStats = readJson('patterns/corpus_stats/cns_tail_structures.json')
  const sentlenRaw = readJson('patterns/ai_contrast/human_sentlen.json')
  const patterns = readJsonl('patterns/patterns.jsonl')
  const collocations = readJsonl('patterns/collocations.jsonl')
  const substitutes = readJsonl('patterns/human_substitutes.jsonl')
  const logodds = readJsonl('patterns/ai_contrast/facts_mode/lexicon_logodds.jsonl')

  const natFreq = cnsWordfreq?.nature?.wordfreq_per_million || {}
  const natAiSeeds = cnsWordfreq?.nature?.ai_seed_per_million || {}
  const exemptSet = new Set(AI_BASELINE_EXEMPT.map((x) => x.toLowerCase()))

  // 1. 构造精简且低误报的 AI 词典（融合 ai_seed_per_million 与 logodds 高偏倚 stylistic 词条）
  const aiMap = new Map()
  const addAiTerm = (term, cnsPerMillion, tier) => {
    const norm = term.trim().toLowerCase()
    if (!norm || exemptSet.has(norm) || NOISE_STOP_TERMS.has(norm)) return
    const prev = aiMap.get(norm)
    if (!prev || tier === 'strict') {
      aiMap.set(norm, {
        term: norm,
        cnsPerMillion: Number((cnsPerMillion ?? 0).toFixed(2)),
        tier,
      })
    }
  }

  for (const [term, cnsRate] of Object.entries(natAiSeeds)) {
    const norm = term.toLowerCase()
    if (exemptSet.has(norm)) continue
    // CNS < 10/M 属于近零高频 AI 词，strict 级；10~55/M 属于簇聚/弱提示
    if (cnsRate < 10) {
      addAiTerm(norm, cnsRate, 'strict')
    } else if (cnsRate < 55) {
      addAiTerm(norm, cnsRate, 'cluster')
    }
  }

  for (const item of logodds) {
    const term = String(item.term || item.ngram || '').trim().toLowerCase()
    if (!term || exemptSet.has(term) || NOISE_STOP_TERMS.has(term)) continue
    if (/^[a-z]{1,2}-/.test(term)) continue
    if (item.dir !== 'ai') continue
    if ((item.z ?? 0) < 3.0) continue
    if ((item.per_million_hum ?? 999) >= 100) continue
    const cns = natAiSeeds[term] ?? natFreq[term] ?? item.per_million_hum ?? 0
    addAiTerm(term, cns, cns < 8 && !term.includes(' ') ? 'strict' : 'cluster')
  }

  for (const t of STRICT_EXTRA_TROPES) {
    addAiTerm(t, natAiSeeds[t] ?? natFreq[t] ?? 1.5, 'strict')
  }
  for (const t of CLUSTER_EXTRA_TROPES) {
    addAiTerm(t, natAiSeeds[t] ?? natFreq[t] ?? 15, 'cluster')
  }

  const aiLexicon = Array.from(aiMap.values()).sort((a, b) =>
    a.tier === b.tier ? a.term.localeCompare(b.term) : a.tier === 'strict' ? -1 : 1,
  )

  // 2. 句长分布基准
  const humanSentlen = {}
  for (const [sec, stat] of Object.entries(sentlenRaw?.by_section || {})) {
    humanSentlen[sec] = {
      nSents: stat.n_sents,
      p10: stat.p10,
      p50: stat.p50,
      p90: stat.p90,
    }
  }

  // 3. Human Substitutes（去 anchors，只保留前 5 个高可信人写替代）
  const humanSubstitutes = substitutes.map((item) => ({
    target: item.target,
    substitutes: (item.substitutes || []).slice(0, 5).map((s) => ({
      text: s.text,
      count: s.count,
      nPapers: s.n_papers,
    })),
  }))

  // 4. Move 骨架与高频搭配索引（仅抽 confirmed 骨架且去 anchors，控制体积）
  const patByMove = new Map()
  for (const p of patterns) {
    if (p.status !== 'confirmed') continue
    const moveId = p.move
    if (!moveId || !p.skeleton) continue
    if (p.skeleton.length > 220) continue
    if (!patByMove.has(moveId)) patByMove.set(moveId, [])
    patByMove.get(moveId).push({
      skeleton: p.skeleton,
      genre: p.genre || 'nature',
      section: p.section || 'results',
      family: p.family || undefined,
    })
  }

  const collByMove = new Map()
  for (const c of collocations) {
    if (c.status !== 'confirmed' || !c.collocation) continue
    const moveIds = new Set([...(c.moves || []), ...Object.keys(c.move_counts || {})])
    for (const mId of moveIds) {
      if (!collByMove.has(mId)) collByMove.set(mId, [])
      collByMove.get(mId).push({
        collocation: c.collocation,
        score: (c.move_counts?.[mId] ?? 1) * 100 + (c.n_papers ?? 0),
      })
    }
  }

  const moves = (moveCatalog?.moves || []).map((m) => {
    const rawPats = patByMove.get(m.id) || []
    // 按体裁分散挑选最多 3 条干净、简练的骨架（prioritize shortest crisp confirmed templates >= 25 chars）
    const sortedPats = [...rawPats]
      .filter((x) => x.skeleton.length >= 25)
      .sort((a, b) => a.skeleton.length - b.skeleton.length)

    const pickedPats = []
    const seenGenres = new Set()
    // 先各体裁挑一条最短代表句
    for (const p of sortedPats) {
      if (pickedPats.length >= 3) break
      if (!seenGenres.has(p.genre)) {
        seenGenres.add(p.genre)
        pickedPats.push(p)
      }
    }
    for (const p of sortedPats) {
      if (pickedPats.length >= 3) break
      if (!pickedPats.includes(p)) pickedPats.push(p)
    }

    const colls = (collByMove.get(m.id) || [])
      .sort((a, b) => b.score - a.score)
      .map((x) => x.collocation)
    const uniqueColls = Array.from(new Set(colls)).slice(0, 5)

    const dg = downgrades[m.id]
    return {
      id: m.id,
      label: m.label,
      sections: m.sections || [],
      aliases: m.aliases || [],
      status: dg?.status === 'candidate' ? 'candidate' : 'confirmed',
      ...(dg?.dual_judge_precision != null ? { dualJudgePrecision: dg.dual_judge_precision } : {}),
      skeletons: pickedPats,
      collocations: uniqueColls,
    }
  })

  const bundle = {
    version: '2.3.0',
    sourceSkill: 'biomedical-polish',
    generatedAt: new Date().toISOString().slice(0, 10),
    aiExempt: AI_BASELINE_EXEMPT,
    aiLexicon,
    humanSentlen,
    humanSubstitutes,
    cnsTailBaseline: {
      naturePct: tailStats?.nature?.paragraph_final_ing_tail_pct_of_paragraphs ?? 1.62,
      cellPct: tailStats?.cell?.paragraph_final_ing_tail_pct_of_paragraphs ?? 1.68,
      clinicalPct: tailStats?.clinical?.paragraph_final_ing_tail_pct_of_paragraphs ?? 1.71,
    },
    moves,
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  const jsonText = JSON.stringify(bundle, null, 2) + '\n'
  fs.writeFileSync(OUT_FILE, jsonText, 'utf-8')
  const kb = (Buffer.byteLength(jsonText, 'utf-8') / 1024).toFixed(1)
  console.log(
    `[sync-skill-assets] Wrote ${OUT_FILE} (${kb} KB): ${moves.length} moves, ${aiLexicon.length} AI lexicon entries, ${humanSubstitutes.length} substitute sets`,
  )
}

main()
