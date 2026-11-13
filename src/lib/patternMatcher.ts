/**
 * 基于场景、论文体裁与中英文生信关键词的按需骨架匹配器。
 * 参考 biomedical-polish/tools/query_patterns.py，每次仅注入最贴合的 1-2 个 confirmed 骨架与常用搭配，
 * 并严格隔离 [method-tool] 类算法评估模板，避免混入临床/队列正文。
 */
import skillBundle from '../data/biomedicalSkill.json'
import type { PaperProfile, Scene } from '../types'

export interface MatchedPattern {
  id: string
  label: string
  status: 'confirmed' | 'candidate'
  skeleton: string
  collocations: string[]
  tip?: string
}

interface MoveRule {
  id: string
  cues: RegExp
  sections?: Scene[]
  methodToolOnly?: boolean
  tip?: string
}

const MOVE_RULES: MoveRule[] = [
  {
    id: 'cohort_enrollment',
    cues: /患者|入组|队列|纳入|排除|随访|clinical|patient|cohort|enrolled|screened|ffpe|biops/i,
    sections: ['methods', 'results', 'abstract'],
  },
  {
    id: 'qc_batch_correction',
    cues: /质控|过滤|线粒体|双细胞|批次|整合|标准化|harmony|scvi|seurat|doublet|mitochondrial|quality control|batch/i,
    sections: ['methods', 'results'],
    tip: '[N14] 批次整合只交代对齐目标与检验指标，勿将软件默认参数当生物学发现。',
  },
  {
    id: 'cell_annotation',
    cues: /细胞注释|细胞类型|亚群|簇|clustering|annotat|umap|cell type|subpopulation|cluster/i,
    sections: ['results', 'methods'],
    tip: '[M01-M05] 细胞状态/亚群命名须锚定特征基因表达，不可仅凭单细胞聚类直接等同于功能已证实。',
  },
  {
    id: 'marker_definition',
    cues: /标志物|marker|高表达|共表达|lineage|signature gene/i,
    sections: ['results', 'figure_legends'],
    tip: '[L37-L45] marker 共表达用于界定表型亚群，不能替代谱系追踪证明细胞起源转化。',
  },
  {
    id: 'differential_expression',
    cues: /差异表达|上调|下调|deg|log2fc|fold change|volcano|upregulated|downregulated/i,
    sections: ['results', 'figure_legends'],
    tip: '差异基因比较须明确对照组与 FDR 阈值，避免无比较锚点的 higher/lower。',
  },
  {
    id: 'pathway_enrichment',
    cues: /通路|富集|gsea|gsva|ssgsea|kegg|go|hallmark|pathway|enrichment|reactome/i,
    sections: ['results', 'figure_legends'],
    tip: '通路富集得分反映转录特征趋向，使用 enriched in / associated with，慎用 activates/drives。',
  },
  {
    id: 'trajectory_pseudotime',
    cues: /拟时序|轨迹|分化|monocle|slingshot|rna velocity|scvelo|pseudotime|trajectory|lineage/i,
    sections: ['results', 'methods'],
    tip: '[M03] 拟时序属于转录相似性排序，需用 aligned along / inferred trajectory 表述，不可称直接证明时序分化。',
  },
  {
    id: 'cell_communication',
    cues: /细胞通讯|配体|受体|cellchat|nichenet|cellphonedb|ligand|receptor|crosstalk|interaction/i,
    sections: ['results', 'discussion'],
    tip: '基于配体-受体共表达的通讯推断属假说生成证据（inferred / putative interaction），需避开物理结合断言。',
  },
  {
    id: 'regulon_inference',
    cues: /转录因子|调控网络|regulon|scenic|pyscenic|motif|atac|chromatin|regulon/i,
    sections: ['results', 'methods'],
  },
  {
    id: 'spatial_deconvolution',
    cues: /空间转录组|空间|微环境|niche|visium|cell2location|rctd|spatial|deconvolution|compartment/i,
    sections: ['results', 'methods', 'discussion'],
  },
  {
    id: 'survival_multivariable_cox',
    cues: /生存|预后|总生存|无进展|风险比|cox|kaplan|meier|os|pfs|dfs|hazard ratio|\bhr\b|prognos|survival/i,
    sections: ['results', 'abstract', 'discussion'],
    tip: '多变量 Cox 须区分独立关联（independently associated with）与因果效应。',
  },
  {
    id: 'subtype_classification_roc',
    cues: /受试者工作|roc|auc|auroc|诊断|分型|判别|classifier|nomogram|roc|discrimination/i,
    sections: ['results', 'methods', 'abstract'],
  },
  {
    id: 'cross_cohort_replication',
    cues: /外部验证|独立队列|多中心|验证集|validation|replicated|recapitulated|independent cohort|tcga|geo/i,
    sections: ['results', 'abstract', 'discussion'],
  },
  {
    id: 'sensitivity_analysis',
    cues: /敏感性|稳健性|校正|confound|sensitivity|multivariable|adjusted/i,
    sections: ['results', 'methods'],
  },
  {
    id: 'wet_validation',
    cues: /免疫组化|蛋白印迹|流式|敲除|敲降|体内|动物|ihc|western|flow cytometry|qpcr|elisa|knockdown|knockout|xenograft/i,
    sections: ['results', 'methods'],
    tip: '仅当具备基因敲除/过表达/干预对照实验时，方可使用 required for / promoted / attenuated 等强干预动词。',
  },
  {
    id: 'mechanism_interpretation',
    cues: /机制|介导|轴|调控|mechanism|mediates|axis|underlying|explains/i,
    sections: ['results', 'discussion'],
  },
  {
    id: 'consistency_check',
    cues: /一致|符合|吻合|consistent with|concordant|corroborat/i,
    sections: ['results', 'discussion'],
  },
  {
    id: 'limitation_scoping',
    cues: /局限|不足|回顾性|单中心|尚待|limitation|retrospective|future studies|warrant/i,
    sections: ['discussion', 'conclusion'],
    tip: '局限段落禁止用 Although 引导与主句呈因果关系的让步从句，只列证据范围+待补验证方向。',
  },
  {
    id: 'benchmarking',
    cues: /基准|优于|超越|对比方法|benchmark|outperform|baseline|sota|ablation/i,
    sections: ['results', 'abstract', 'methods'],
    methodToolOnly: true,
    tip: '[PA01-PA06] 算法性能优于基线需同时给出测试集规模与指标差值，不空泛宣称 superior。',
  },
  {
    id: 'model_construction',
    cues: /架构|损失函数|注意力|编码器|超参数|loss function|architecture|encoder|embedding|training|epoch/i,
    sections: ['methods', 'results'],
    methodToolOnly: true,
  },
  {
    id: 'cross_dataset_generalization',
    cues: /泛化|跨数据集|迁移|域适应|generaliz|domain shift|zero-shot|transfer/i,
    sections: ['results', 'discussion'],
    methodToolOnly: true,
  },
  {
    id: 'abs_background_premise',
    cues: /背景|发病率|临床需求|remains|challenge|poor prognosis/i,
    sections: ['abstract'],
  },
  {
    id: 'abs_primary_finding',
    cues: /本研究|我们发现|揭示|证明|here, we|we identified|we demonstrated/i,
    sections: ['abstract'],
  },
  {
    id: 'intro_knowledge_gap_pivot',
    cues: /然而|尚不清楚|缺乏|仍未知|however|remains poorly understood|remains unclear|gap/i,
    sections: ['introduction'],
  },
  {
    id: 'intro_here_we_overview',
    cues: /因此|本研究|为此|to address|here, we|in this study/i,
    sections: ['introduction'],
  },
  {
    id: 'disc_opening_convergence',
    cues: /综上所述|本研究发现|总体而言|in this study|our findings|collect/i,
    sections: ['discussion', 'conclusion'],
  },
  {
    id: 'disc_mechanistic_decoupling',
    cues: /转录与蛋白|不一致|解耦|decoupling|discordance|post-transcriptional/i,
    sections: ['discussion'],
  },
  {
    id: 'leg_stat_test_correction',
    cues: /检验|p值|wilcoxon|mann|t-test|anova|benjamini|fdr|boxplot|error bar/i,
    sections: ['figure_legends'],
  },
  {
    id: 'leg_title_declarative',
    cues: /图\s*\d+|fig\.?|figure\s*\d+/i,
    sections: ['figure_legends'],
  },
]

function targetGenreForProfile(profile: PaperProfile): string {
  if (profile === 'cell-omics') return 'cell'
  if (profile === 'general-clinical') return 'clinical'
  return 'nature'
}

/**
 * 为当前段落精准匹配 1~2 条已验证骨架与高频搭配；
 * token 预算受控，严格隔离非方法学论文的 [method-tool] 骨架。
 */
export function matchSkillPatterns(args: {
  scene: Scene
  profile: PaperProfile
  zh?: string
  en?: string
  maxMatches?: number
}): MatchedPattern[] {
  const { scene, profile, zh = '', en = '', maxMatches = 2 } = args
  const combined = `${zh}\n${en}`.trim()
  if (!combined) return []

  const moveIndex = new Map(skillBundle.moves.map((m) => [m.id, m]))
  const targetGenre = targetGenreForProfile(profile)
  const scored: Array<{ rule: MoveRule; score: number }> = []

  for (const rule of MOVE_RULES) {
    // [method-tool] 规则仅在方法学论文或明确存在相关方法学对比时触发
    if (rule.methodToolOnly && profile !== 'method-tool') {
      if (!/benchmark|ablation|outperform|loss function|baseline/i.test(combined)) continue
    }
    if (!rule.cues.test(combined)) continue
    const moveData = moveIndex.get(rule.id)
    if (!moveData || !moveData.skeletons.length) continue

    let score = 10
    if (rule.sections?.includes(scene)) score += 6
    if (moveData.sections?.includes(scene)) score += 4
    // 优先选用经双盲判定 confirmed 的 Move，未证实仅降权作参考
    if (moveData.status === 'confirmed') score += 8
    else score -= 4

    scored.push({ rule, score })
  }

  scored.sort((a, b) => b.score - a.score)

  const out: MatchedPattern[] = []
  for (const { rule } of scored) {
    if (out.length >= maxMatches) break
    const m = moveIndex.get(rule.id)
    if (!m || !m.skeletons.length) continue

    const bestSkeleton =
      m.skeletons.find((s) => s.genre === targetGenre && s.section === scene) ??
      m.skeletons.find((s) => s.genre === targetGenre) ??
      m.skeletons.find((s) => s.section === scene) ??
      m.skeletons[0]

    out.push({
      id: m.id,
      label: m.label,
      status: (m.status === 'confirmed' ? 'confirmed' : 'candidate'),
      skeleton: bestSkeleton.skeleton,
      collocations: m.collocations.slice(0, 4),
      tip: rule.tip,
    })
  }

  return out
}
