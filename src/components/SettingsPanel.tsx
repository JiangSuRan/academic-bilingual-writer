// 设置面板:模型服务、密钥、翻译模式、场景、自定义提示词、术语表
import { useEffect, useState } from 'react'
import { X, Plus, Trash2, PlugZap, CheckCircle2, KeyRound } from 'lucide-react'
import { useStore } from '../store/docStore'
import { api } from '../lib/commands'
import { parseGlossaryText, renderGlossaryText } from '../lib/glossary'
import { SCENE_LABELS, PROFILE_LABELS, QUALITY_LABELS } from '../lib/prompts'
import { nanoid } from '../lib/nanoid'
import type { PaperProfile, Scene, TranslateQuality } from '../types'

export default function SettingsPanel() {
  const config = useStore((s) => s.config)
  const apiKeyReady = useStore((s) => s.apiKeyReady)
  const openSettings = useStore((s) => s.openSettings)
  const updateConfig = useStore((s) => s.updateConfig)
  const saveApiKey = useStore((s) => s.saveApiKey)
  const loadApiKeyState = useStore((s) => s.loadApiKeyState)
  const testConn = useStore((s) => s.testConn)
  const showToast = useStore((s) => s.showToast)

  const [keyDraft, setKeyDraft] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  const active = config.providers.find((p) => p.id === config.activeProviderId) ?? config.providers[0] ?? null
  const activeId = active?.id ?? ''

  // 打开面板时查询当前 provider 的密钥存在状态
  useEffect(() => {
    if (activeId) void loadApiKeyState(activeId)
  }, [activeId, loadApiKeyState])

  const patchProvider = (id: string, patch: Partial<(typeof config.providers)[number]>) => {
    void updateConfig({ providers: config.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  }

  const addProvider = () => {
    const id = `p-${nanoid(8)}`
    void updateConfig({
      providers: [...config.providers, { id, name: '新配置', baseUrl: 'https://api.openai.com/v1', model: '', temperature: 0.3 }],
      activeProviderId: config.activeProviderId ?? id,
    })
  }

  const removeProvider = (id: string) => {
    const providers = config.providers.filter((p) => p.id !== id)
    void api.deleteApiKey(id).catch(() => {})
    void updateConfig({
      providers,
      activeProviderId: config.activeProviderId === id ? providers[0]?.id ?? null : config.activeProviderId,
    })
  }

  const doTest = async () => {
    if (!active) return
    setTesting(true)
    setTestResult(null)
    try {
      const reply = await testConn({ providerId: active.id, baseUrl: active.baseUrl, model: active.model })
      setTestResult(`✓ 连接成功:${reply}`)
    } catch (e) {
      setTestResult(`✗ ${String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  const glossaryPairs = parseGlossaryText(config.glossaryText)

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && openSettings(false)}>
      <div className="settings-panel">
        <div className="settings-head">
          设置
          <button onClick={() => openSettings(false)} title="关闭"><X size={17} /></button>
        </div>
        <div className="settings-body">
          {/* ---- 模型服务 ---- */}
          <div className="settings-section">
            <div className="sec-title">模型服务(OpenAI 兼容接口)</div>
            {config.providers.map((p) => (
              <div key={p.id} className={`provider-row ${p.id === config.activeProviderId ? 'active' : ''}`}>
                <button
                  className={`mini-btn ${p.id === config.activeProviderId ? 'primary' : ''}`}
                  title="设为当前使用的服务"
                  onClick={() => void updateConfig({ activeProviderId: p.id })}
                >
                  {p.id === config.activeProviderId ? '使用中' : '启用'}
                </button>
                <input className="text-input" style={{ maxWidth: 110 }} value={p.name} placeholder="名称"
                  onChange={(e) => patchProvider(p.id, { name: e.target.value })} />
                <input className="text-input mono" value={p.baseUrl} placeholder="https://api.openai.com/v1"
                  onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })} title="API Base URL" />
                <input className="text-input mono" style={{ maxWidth: 150 }} value={p.model} placeholder="模型名"
                  onChange={(e) => patchProvider(p.id, { model: e.target.value })} title="模型名称" />
                <button className="mini-btn danger" title="删除此配置" onClick={() => removeProvider(p.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button className="mini-btn" onClick={addProvider}><Plus size={13} /> 添加服务配置</button>
            <p className="hint">
              支持 OpenAI、DeepSeek、Qwen(DashScope 兼容模式)、OpenRouter 及任意 OpenAI 兼容端点;填入对应 Base URL 与模型名即可。
            </p>
          </div>

          {/* ---- API Key ---- */}
          {active && (
            <div className="settings-section">
              <div className="sec-title">API Key({active.name || '当前服务'})</div>
              <div className="form-row">
                <label><KeyRound size={12} style={{ verticalAlign: -2 }} /> 密钥</label>
                <input
                  className="text-input mono long"
                  type="password"
                  value={keyDraft}
                  placeholder={apiKeyReady[active.id] ? '已保存(输入新值可覆盖)' : 'sk-…'}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  autoComplete="off"
                />
                <button
                  className="mini-btn primary"
                  disabled={!keyDraft.trim()}
                  onClick={async () => {
                    try {
                      await saveApiKey(active.id, keyDraft.trim())
                      setKeyDraft('')
                      showToast('success', '密钥已保存到系统凭据管理器')
                    } catch (e) {
                      showToast('error', `密钥保存失败:${String(e)}`)
                    }
                  }}
                >
                  保存密钥
                </button>
              </div>
              <div className="form-row">
                <label>连接测试</label>
                <button className="mini-btn" disabled={testing || !active.baseUrl || !active.model} onClick={() => void doTest()}>
                  <PlugZap size={13} /> {testing ? '测试中…' : '测试连接'}
                </button>
                {testResult && (
                  <span style={{ fontSize: 12, color: testResult.startsWith('✓') ? 'var(--green)' : 'var(--red)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {testResult.startsWith('✓') && <CheckCircle2 size={13} />}
                    {testResult}
                  </span>
                )}
              </div>
              <div className="form-row">
                <label>Temperature</label>
                <input
                  className="num-input" type="number" min={0} max={2} step={0.1}
                  style={{ maxWidth: 90 }}
                  value={active.temperature}
                  onChange={(e) => patchProvider(active.id, { temperature: Math.min(2, Math.max(0, Number(e.target.value) || 0)) })}
                />
                <span className="hint" style={{ margin: 0 }}>学术写作建议 0.2–0.5</span>
              </div>
              <p className="hint">密钥存储在 Windows 凭据管理器中,不写入任何明文配置文件;请求日志不记录密钥与文稿内容。</p>
            </div>
          )}

          {/* ---- 翻译模式 ---- */}
          <div className="settings-section">
            <div className="sec-title">翻译模式</div>
            <div className="form-row">
              <label>自动翻译</label>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={config.autoTranslate}
                  onChange={(e) => void updateConfig({ autoTranslate: e.target.checked })}
                  id="auto-t"
                />
                <label className="track" htmlFor="auto-t" />
              </span>
              <span className="hint" style={{ margin: 0 }}>
                {config.autoTranslate
                  ? '输入停顿后自动翻译「未翻译」段落;已修改/已编辑的段落不受影响,需手动触发'
                  : '关闭:手动 Ctrl+Enter 或点击按钮生成'}
              </span>
            </div>
            <div className="form-row">
              <label>停顿时长</label>
              <input
                className="num-input" type="number" min={800} max={8000} step={100}
                style={{ maxWidth: 110 }}
                value={config.autoDelayMs}
                disabled={!config.autoTranslate}
                onChange={(e) => void updateConfig({ autoDelayMs: Math.min(8000, Math.max(800, Number(e.target.value) || 2000)) })}
              />
              <span className="hint" style={{ margin: 0 }}>毫秒;输入法组合输入期间不会触发</span>
            </div>
            <div className="form-row">
              <label>默认场景</label>
              <select
                className="model-select"
                value={config.defaultScene}
                onChange={(e) => void updateConfig({ defaultScene: e.target.value as Scene })}
              >
                {(Object.keys(SCENE_LABELS) as Scene[]).map((s) => (
                  <option key={s} value={s}>{SCENE_LABELS[s]}</option>
                ))}
              </select>
              <span className="hint" style={{ margin: 0 }}>新段落使用的写作场景;每段可单独调整</span>
            </div>
          </div>

          {/* ---- 学术润色引擎 (biomedical-polish) ---- */}
          <div className="settings-section">
            <div className="sec-title">顶刊润色引擎与文风基准</div>
            <div className="form-row">
              <label>论文体裁</label>
              <select
                className="model-select long"
                value={config.paperProfile}
                onChange={(e) => void updateConfig({ paperProfile: e.target.value as PaperProfile })}
              >
                {(Object.keys(PROFILE_LABELS) as PaperProfile[]).map((p) => (
                  <option key={p} value={p}>{PROFILE_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>译写标准</label>
              <select
                className="model-select long"
                value={config.translateQuality}
                onChange={(e) => void updateConfig({ translateQuality: e.target.value as TranslateQuality })}
              >
                {(Object.keys(QUALITY_LABELS) as TranslateQuality[]).map((q) => (
                  <option key={q} value={q}>{QUALITY_LABELS[q]}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>润色/回炉模型</label>
              <select
                className="model-select long"
                value={config.polishProviderId ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null
                  void updateConfig({ polishProviderId: v })
                  if (v) void loadApiKeyState(v)
                }}
              >
                <option value="">跟随主翻译模型（{active ? `${active.name} · ${active.model}` : '未选'}）</option>
                {config.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.model}
                  </option>
                ))}
              </select>
            </div>
            <p className="hint" style={{ marginBottom: 8 }}>
              建议搭配：主模型选轻快/本地直译模型（如 Hunyuan-MT-7B），「润色/回炉模型」指定 DeepSeek / GPT 等强指令模型，实现“译后本地体检 → 红牌自动纯减法回炉”闭环。
            </p>
            <div className="form-row">
              <label>作者视角槽</label>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={config.showAuthorSlots}
                  onChange={(e) => void updateConfig({ showAuthorSlots: e.target.checked })}
                  id="show-author-slots"
                />
                <label className="track" htmlFor="show-author-slots" />
              </span>
              <span className="hint" style={{ margin: 0 }}>
                检测到方法决策、预期反差或空泛局限时，在段末提供一句话补充意图插槽（默认折叠）
              </span>
            </div>
          </div>

          {/* ---- 提示词与术语表 ---- */}
          <div className="settings-section">
            <div className="sec-title">自定义提示词(附加要求)</div>
            <textarea
              className="text-input"
              rows={3}
              value={config.customPrompt}
              placeholder="例如:目标期刊为 British English;细胞系名称保留原格式;避免使用 however 开头…"
              onChange={(e) => void updateConfig({ customPrompt: e.target.value })}
            />
            <p className="hint">附加到每次请求;不能覆盖内置的事实与统计信息安全规则。</p>
          </div>

          <div className="settings-section">
            <div className="sec-title">专业术语表({glossaryPairs.length} 条)</div>
            <textarea
              className="text-input"
              rows={6}
              value={config.glossaryText}
              placeholder={'每行一条:中文 => English\n例如:\n免疫检查点 => immune checkpoint\n无病生存期 => disease-free survival'}
              onChange={(e) => void updateConfig({ glossaryText: e.target.value })}
            />
            <p className="hint">
              支持制表符或 <code>=&gt;</code> 分隔;<code>#</code> 开头为注释。仅当前段落中出现的术语会随请求发送。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// 术语表编辑是纯文本操作,这里提供程序化回填(保留给后续批量导入使用)
export function glossaryToText(pairs: { zh: string; en: string }[]): string {
  return renderGlossaryText(pairs)
}
