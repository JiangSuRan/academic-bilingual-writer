import {
  FilePlus2, FolderOpen, Save, Copy, Settings2, Moon, Sun, Languages,
} from 'lucide-react'
import { useStore } from '../store/docStore'

export default function Toolbar() {
  const doc = useStore((s) => s.doc)
  const filePath = useStore((s) => s.filePath)
  const save = useStore((s) => s.save)
  const config = useStore((s) => s.config)
  const busyCount = Object.keys(useStore((s) => s.translatingIds)).length
  const newDoc = useStore((s) => s.newDoc)
  const openDocDialog = useStore((s) => s.openDocDialog)
  const saveDoc = useStore((s) => s.saveDoc)
  const setTitle = useStore((s) => s.setTitle)
  const copyAllEn = useStore((s) => s.copyAllEn)
  const translateAllPending = useStore((s) => s.translateAllPending)
  const openSettings = useStore((s) => s.openSettings)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const updateConfig = useStore((s) => s.updateConfig)

  const saveLabel = save.saving
    ? '保存中…'
    : save.dirty
      ? '未保存'
      : save.lastSavedAt
        ? `已保存 ${new Date(save.lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        : '未保存'

  return (
    <div className="toolbar">
      <button className="tb-btn" title="新建文稿 (Ctrl+N)" onClick={() => void newDoc()}>
        <FilePlus2 size={15} /> 新建
      </button>
      <button className="tb-btn" title="打开文稿" onClick={() => void openDocDialog()}>
        <FolderOpen size={15} /> 打开
      </button>
      <button className="tb-btn" title="保存文稿 (Ctrl+S)" onClick={() => void saveDoc()}>
        <Save size={15} /> 保存
      </button>
      <span className="tb-sep" />
      <input
        className="doc-title-input"
        value={doc.title}
        onChange={(e) => setTitle(e.target.value)}
        title={filePath ?? '尚未保存到文件'}
        placeholder="文稿名称"
        spellCheck={false}
      />
      <span className={`save-state ${save.dirty ? 'dirty' : ''}`}>{saveLabel}</span>
      <span className="tb-spacer" />
      <select
        className="model-select"
        value={config.activeProviderId ?? ''}
        onChange={(e) => void updateConfig({ activeProviderId: e.target.value })}
        title="当前模型配置"
      >
        {config.providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} · {p.model}
          </option>
        ))}
      </select>
      <button
        className="tb-btn primary"
        title="批量翻译所有未翻译段落(已有译文的段落不会被覆盖)"
        disabled={busyCount > 0}
        onClick={() => void translateAllPending()}
      >
        <Languages size={15} /> {busyCount > 0 ? `翻译中(${busyCount})` : '翻译全部未译'}
      </button>
      <button className="tb-btn" title="复制全部英文为纯文本 (Ctrl+Shift+C)" onClick={() => void copyAllEn()}>
        <Copy size={15} /> 复制英文
      </button>
      <span className="tb-sep" />
      <button className="tb-btn" title={config.theme === 'dark' ? '切换到浅色' : '切换到深色'} onClick={toggleTheme}>
        {config.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button className="tb-btn" title="设置" onClick={() => openSettings(true)}>
        <Settings2 size={15} />
      </button>
    </div>
  )
}
