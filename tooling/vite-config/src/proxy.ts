import type { ProxyOptions } from 'vite'
import type { IViteEnv } from './env/types.ts'

/**
 * 开发代理表。两个开关分别是 `env.proxy[0]`（/api 一类）与 `env.proxy[1]`（websocket），
 * **都是数字 1 才启用**（`VITE_PROXY` 的 JSON 里写 1 / 0）；都关着时返回空对象、不配任何代理。
 * ws 那条的 target 是 `ws[2] + ws[3]`（协议 + 主机，如 `ws://` + `127.0.0.1:3000/w/v1`）。
 */
export function createViteProxy(env: IViteEnv) {
  const ret: Record<string, ProxyOptions> = {}

  const api = env.proxy[0]
  const ws = env.proxy[1]

  if (+api[0] === 1) {
    const prefix = api[1]
    const target = api[2]

    ret[prefix] = {
      target,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(new RegExp(`^${prefix}`), ''),
      secure: false,
      ws: true,
    }
  }

  if (+ws[0] === 1) {
    const prefix = ws[1]
    const target = `${ws[2]}${ws[3]}`

    ret[prefix] = {
      target,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(new RegExp(`^${prefix}`), ''),
      secure: false,
      ws: true,
    }
  }

  return ret
}
