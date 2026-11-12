// 轻量 CDP 驱动:连接 Tauri WebView2 的调试端口,执行 JS 表达式与截图
// 用法: node cdp.mjs eval "表达式"   |   node cdp.mjs shot 输出.png
import { writeFileSync } from 'node:fs'

const CDP = 'http://127.0.0.1:9222'

async function getWsUrl() {
  const list = await (await fetch(`${CDP}/json`)).json()
  const page = list.find((p) => p.type === 'page' && p.url.includes('localhost:1420'))
  if (!page) throw new Error('app page not found: ' + JSON.stringify(list.map((p) => p.url)))
  return page.webSocketDebuggerUrl
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let id = 0
    const pending = new Map()
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id
          pending.set(mid, { res, rej })
          ws.send(JSON.stringify({ id: mid, method, params }))
        })
      },
      close() { ws.close() },
    })
    ws.onerror = reject
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      }
    }
  })
}

const [,, cmd, arg] = process.argv
const ws = await connect(await getWsUrl())

if (cmd === 'eval' || cmd === 'evalf') {
  const expression = cmd === 'evalf' ? (await import('node:fs')).readFileSync(arg, 'utf8') : arg
  const r = await ws.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails, null, 2))
    process.exit(1)
  }
  const v = r.result.value
  console.log(typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v))
} else if (cmd === 'shot') {
  await ws.send('Page.enable')
  const r = await ws.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(arg, Buffer.from(r.data, 'base64'))
  console.log('saved', arg)
} else {
  console.error('usage: node cdp.mjs eval <expr> | evalf <file> | shot <file.png>')
  process.exit(2)
}
ws.close()
