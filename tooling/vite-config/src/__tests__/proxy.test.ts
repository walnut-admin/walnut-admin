import type { IViteEnv } from '../env/types.ts'
import { describe, expect, it } from 'vitest'
import { createViteProxy } from '../proxy.ts'

function makeEnv(proxy: IViteEnv['proxy']): IViteEnv {
  return {
    port: 3100,
    host: '127.0.0.1',
    title: 'test',
    publicPath: '/',
    proxy,
    gaId: '',
    dev: { csp: false },
    build: {
      outDir: 'dist',
      obfuscator: false,
      dropConsole: false,
      compression: false,
      analyzer: false,
      banner: false,
      cdn: false,
      disableBrowserDevtool: false,
      csp: false,
      legacy: false,
      sentry: { enabled: false, dsn: '', org: '', project: '', authToken: '' },
    },
  }
}

describe('createViteProxy', () => {
  it('两个开关都关着时不配任何代理', () => {
    const proxy = createViteProxy(makeEnv([
      [0, '/api', 'http://127.0.0.1:3000/w/v1'],
      [0, '/ws', 'ws://', '127.0.0.1:3000/w/v1', ''],
    ]))

    expect(proxy).toEqual({})
    expect(Object.keys(proxy)).toHaveLength(0)
  })

  it('api 开关打开时挂上前缀、target 与去前缀的 rewrite', () => {
    const proxy = createViteProxy(makeEnv([
      [1, '/api', 'http://127.0.0.1:3000/w/v1'],
      [0, '/ws', 'ws://', '127.0.0.1:3000/w/v1', ''],
    ]))

    expect(Object.keys(proxy)).toEqual(['/api'])
    expect(proxy['/api']).toMatchObject({
      target: 'http://127.0.0.1:3000/w/v1',
      changeOrigin: true,
      secure: false,
      ws: true,
    })
    expect(proxy['/api'].rewrite?.('/api/system/user')).toBe('/system/user')
  })

  it('ws 开关打开时 target 是协议段与主机段的拼接', () => {
    const proxy = createViteProxy(makeEnv([
      [0, '/api', 'http://127.0.0.1:3000/w/v1'],
      [1, '/ws', 'ws://', '127.0.0.1:3000/w/v1', ''],
    ]))

    expect(Object.keys(proxy)).toEqual(['/ws'])
    expect(proxy['/ws']).toMatchObject({
      target: 'ws://127.0.0.1:3000/w/v1',
      changeOrigin: true,
      secure: false,
      ws: true,
    })
    expect(proxy['/ws'].rewrite?.('/ws/socket')).toBe('/socket')
  })

  it('两个开关都打开时两条代理都在', () => {
    const proxy = createViteProxy(makeEnv([
      [1, '/api', 'http://127.0.0.1:3000/w/v1'],
      [1, '/ws', 'wss://', 'example.com/socket', ''],
    ]))

    expect(Object.keys(proxy)).toEqual(['/api', '/ws'])
    expect(proxy['/ws'].target).toBe('wss://example.com/socket')
  })

  it('开关按数值判定：字符串 0 / 1 与数字等价', () => {
    const proxy = createViteProxy(makeEnv([
      ['0', '/api', 'http://127.0.0.1:3000/w/v1'],
      ['1', '/ws', 'ws://', '127.0.0.1:3000/w/v1', ''],
    ] as unknown as IViteEnv['proxy']))

    expect(Object.keys(proxy)).toEqual(['/ws'])
  })
})
