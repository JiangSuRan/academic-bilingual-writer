// 轻量唯一 id:优先 crypto.getRandomValues,回退 Math.random
// 段落 id 只要求进程内唯一 + 跨会话稳定存储,不需要完整 UUIDv4 语义

const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict'

export function nanoid(size = 21): string {
  const bytes = new Uint8Array(size)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < size; i++) bytes[i] = (Math.random() * 256) | 0
  }
  let id = ''
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i] & 63]
  return id
}
