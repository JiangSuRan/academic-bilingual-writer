import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useStore } from './store/docStore'
import { api } from './lib/commands'
import Toolbar from './components/Toolbar'
import Workspace from './components/Workspace'
import SettingsPanel from './components/SettingsPanel'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'

export default function App() {
  const booted = useStore((s) => s.booted)
  const toast = useStore((s) => s.toast)
  const settingsOpen = useStore((s) => s.settingsOpen)
  const boot = useStore((s) => s.boot)

  useEffect(() => {
    void boot()
  }, [boot])

  // 关闭协议:Rust 拦截关窗 → 前端保存 → confirm 退出;保存被取消则留在应用
  useEffect(() => {
    const un = listen('app-close-requested', async () => {
      const st = useStore.getState()
      if (st.save.dirty) await st.saveDoc()
      if (useStore.getState().save.dirty) {
        // 仍未保存(如用户取消了保存对话框)→ 撤销退出
        await api.cancelClose().catch(() => {})
        return
      }
      await api.confirmClose().catch(() => {
        // 兜底:确认失败也直接退出,交给 Rust 8 秒强退兜底
      })
    })
    return () => { void un.then((f) => f()) }
  }, [])

  // 全局快捷键:Ctrl+S 保存 / Ctrl+N 新建 / Ctrl+Shift+C 复制全部英文
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const st = useStore.getState()
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); void st.saveDoc() }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); void st.newDoc() }
      else if (e.shiftKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); void st.copyAllEn() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!booted) return <div className="app" />

  return (
    <div className="app">
      <Toolbar />
      <Workspace />
      {settingsOpen && <SettingsPanel />}
      {toast && <Toast kind={toast.kind} text={toast.text} />}
    </div>
  )
}

function Toast({ kind, text }: { kind: 'info' | 'error' | 'success'; text: string }) {
  useEffect(() => {
    const timer = setTimeout(() => useStore.setState({ toast: null }), 3600)
    return () => clearTimeout(timer)
  }, [text])
  const Icon = kind === 'error' ? AlertCircle : kind === 'success' ? CheckCircle2 : Info
  return (
    <div className={`toast ${kind}`}>
      <Icon size={15} />
      <span>{text}</span>
    </div>
  )
}
