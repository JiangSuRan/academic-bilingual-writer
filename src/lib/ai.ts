// AI 流式通道:Rust 侧 SSE 解析后经 Tauri 事件推送;此处按 requestId 分发
// API Key 不进入前端:Rust 按providerId 从系统凭据管理器读取

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ChatMsg } from './prompts'

export type AiHandlers = {
  onChunk(delta: string): void
  onDone(cancelled: boolean): void
  onError(message: string): void
}

interface AiEventPayload {
  requestId: string
  delta?: string
  cancelled?: boolean
  message?: string
}

const handlers = new Map<string, AiHandlers>()
let initialized = false

/** 应用启动时注册一次事件监听 */
export async function initAiEvents(): Promise<void> {
  if (initialized) return
  initialized = true
  await listen<AiEventPayload>('ai-chunk', (e) => {
    handlers.get(e.payload.requestId)?.onChunk(e.payload.delta ?? '')
  })
  await listen<AiEventPayload>('ai-done', (e) => {
    const h = handlers.get(e.payload.requestId)
    if (h) {
      handlers.delete(e.payload.requestId)
      h.onDone(e.payload.cancelled === true)
    }
  })
  await listen<AiEventPayload>('ai-error', (e) => {
    const h = handlers.get(e.payload.requestId)
    if (h) {
      handlers.delete(e.payload.requestId)
      h.onError(e.payload.message ?? '未知错误')
    }
  })
}

/**
 * 发起流式请求。命令级失败(未配置 Key、HTTP 错误等)走 invoke 的 reject;
 * 流式阶段失败由 Rust 发 ai://error 事件。
 */
export function streamChat(
  requestId: string,
  provider: { providerId: string; baseUrl: string; model: string; temperature: number },
  messages: ChatMsg[],
  h: AiHandlers,
): void {
  handlers.set(requestId, h)
  invoke('ai_chat_stream', { requestId, provider, messages }).catch((err) => {
    if (handlers.delete(requestId)) h.onError(describeError(err))
  })
}

export function cancelAi(requestId: string): void {
  handlers.delete(requestId)
  invoke('cancel_ai', { requestId }).catch(() => {})
}

export function testConnection(provider: {
  providerId: string
  baseUrl: string
  model: string
}): Promise<string> {
  return invoke<string>('test_connection', { provider })
}

function describeError(err: unknown): string {
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  return String(err)
}
