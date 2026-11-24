import { describe, expect, it } from 'vitest'
import { useBuildEnv } from '../use-build-env.ts'

const PROXY = [[1, '/api', 'http://127.0.0.1:3000/w/v1'], [1, '/ws', 'ws://', '127.0.0.1:3000/w/v1']]

/** 一份「什么开关都开着」的 env 源：断言各字段都映射到位，而不是恰好都是默认值 */
function fullEnv(overrides: Record<string, string> = {}) {
  return {
    VITE_PORT: '3100',
    VITE_HOST: '0.0.0.0',
    VITE_APP_TITLE: 'Walnut Admin',
    VITE_PUBLIC_PATH: '/admin/',
    VITE_PROXY: JSON.stringify(PROXY),
    VITE_GA_ID: 'G-TEST',
    VITE_DEV_CSP: 'true',
    VITE_BUILD_OUT_DIR: 'dist',
    VITE_BUILD_OBFUSCATOR: 'true',
    VITE_BUILD_DROP_CONSOLE: 'true',
    VITE_BUILD_COMPRESSION: 'true',
    VITE_BUILD_ANALYZER: 'true',
    VITE_BUILD_BANNER: 'true',
    VITE_BUILD_CDN: 'true',
    VITE_BUILD_DISABLE_BROWSER_DEVTOOL: 'true',
    VITE_BUILD_CSP: 'true',
    VITE_BUILD_LEGACY: 'true',
    VITE_BUILD_SENTRY: 'true',
    VITE_BUILD_SENTRY_DSN: 'https://key@sentry.example/1',
    VITE_BUILD_SENTRY_ORG: 'walnut',
    VITE_BUILD_SENTRY_PROJECT: 'admin',
    VITE_BUILD_SENTRY_AUTH_TOKEN: 'token',
    ...overrides,
  }
}

describe('useBuildEnv', () => {
  it('把字符串形式的 env 映射成结构化环境', () => {
    expect(useBuildEnv(fullEnv())).toEqual({
      port: 3100,
      host: '0.0.0.0',
      title: 'Walnut Admin',
      publicPath: '/admin/',
      proxy: [[1, '/api', 'http://127.0.0.1:3000/w/v1'], [1, '/ws', 'ws://', '127.0.0.1:3000/w/v1']],
      gaId: 'G-TEST',
      dev: { csp: true },
      build: {
        outDir: 'dist',
        obfuscator: true,
        dropConsole: true,
        compression: true,
        analyzer: true,
        banner: true,
        cdn: true,
        disableBrowserDevtool: true,
        csp: true,
        legacy: true,
        sentry: {
          enabled: true,
          dsn: 'https://key@sentry.example/1',
          org: 'walnut',
          project: 'admin',
          authToken: 'token',
        },
      },
    })
  })

  it('端口是数值（字符串经一元加号转换）', () => {
    expect(useBuildEnv(fullEnv({ VITE_PORT: '8080' })).port).toBe(8080)
    expect(typeof useBuildEnv(fullEnv()).port).toBe('number')
  })

  it('把 VITE_PROXY 按 JSON 解析，保留元组里的数字开关与各段', () => {
    const env = useBuildEnv(fullEnv({
      VITE_PROXY: JSON.stringify([[0, '/api', 'http://127.0.0.1:3000'], [1, '/ws', 'wss://', 'example.com/socket']]),
    }))

    expect(env.proxy).toEqual([[0, '/api', 'http://127.0.0.1:3000'], [1, '/ws', 'wss://', 'example.com/socket']])
  })

  it('布尔量只认字面量 true，false / 1 / 空串都是 false', () => {
    for (const value of ['false', '1', '', 'TRUE']) {
      const env = useBuildEnv(fullEnv({
        VITE_DEV_CSP: value,
        VITE_BUILD_OBFUSCATOR: value,
        VITE_BUILD_DROP_CONSOLE: value,
        VITE_BUILD_COMPRESSION: value,
        VITE_BUILD_ANALYZER: value,
        VITE_BUILD_BANNER: value,
        VITE_BUILD_CDN: value,
        VITE_BUILD_DISABLE_BROWSER_DEVTOOL: value,
        VITE_BUILD_CSP: value,
        VITE_BUILD_LEGACY: value,
        VITE_BUILD_SENTRY: value,
      }))

      expect(env.dev.csp).toBe(false)
      expect(env.build.obfuscator).toBe(false)
      expect(env.build.dropConsole).toBe(false)
      expect(env.build.compression).toBe(false)
      expect(env.build.analyzer).toBe(false)
      expect(env.build.banner).toBe(false)
      expect(env.build.cdn).toBe(false)
      expect(env.build.disableBrowserDevtool).toBe(false)
      expect(env.build.csp).toBe(false)
      expect(env.build.legacy).toBe(false)
      expect(env.build.sentry.enabled).toBe(false)
    }
  })

  it('两个可选构建开关不存在时是关', () => {
    const source: Record<string, string> = fullEnv()
    delete source.VITE_BUILD_CSP
    delete source.VITE_BUILD_LEGACY

    const env = useBuildEnv(source)

    expect(env.build.csp).toBe(false)
    expect(env.build.legacy).toBe(false)
  })

  it('字符串字段不做默认值填充（空串就透出空串）', () => {
    const env = useBuildEnv(fullEnv({ VITE_GA_ID: '', VITE_APP_TITLE: '', VITE_BUILD_SENTRY_DSN: '' }))

    expect(env.gaId).toBe('')
    expect(env.title).toBe('')
    expect(env.build.sentry.dsn).toBe('')
  })
})
