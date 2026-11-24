import type { ViteConfigPluginsOptions } from '../types.ts'
import { describe, expect, it } from 'vitest'
import { useBuildEnv } from '../env/use-build-env.ts'
import { createVitePlugins } from '../plugins/index.ts'

const CSP_PLUGIN = 'vite-plugin-csp-guard'
const SENTRY_PLUGIN = 'sentry-vite-plugin'
// @vitejs/plugin-legacy 一个工厂返回三支插件
const LEGACY_PLUGINS = ['vite:legacy-config', 'vite:legacy-generate-polyfill-chunk', 'vite:legacy-post-process']

/** `useBuildEnv` 的输入：一份全部关闭的基线，用例只覆盖关心的键 */
const BASE_ENV: Record<string, string> = {
  VITE_PORT: '3100',
  VITE_HOST: '127.0.0.1',
  VITE_APP_TITLE: 'Walnut Test',
  VITE_PUBLIC_PATH: '/',
  VITE_PROXY: JSON.stringify([[1, '/api', 'http://127.0.0.1:3000/w/v1'], [0, '/ws', 'ws://127.0.0.1:3000/w/v1', '']]),
  VITE_GA_ID: '',
  VITE_DEV_CSP: 'false',
  VITE_BUILD_OUT_DIR: 'dist',
  VITE_BUILD_OBFUSCATOR: 'false',
  VITE_BUILD_DROP_CONSOLE: 'false',
  VITE_BUILD_CDN: 'false',
  VITE_BUILD_COMPRESSION: 'false',
  VITE_BUILD_ANALYZER: 'false',
  VITE_BUILD_BANNER: 'false',
  VITE_BUILD_DISABLE_BROWSER_DEVTOOL: 'false',
  VITE_BUILD_CSP: 'false',
  VITE_BUILD_LEGACY: 'false',
  VITE_BUILD_SENTRY: 'false',
  VITE_BUILD_SENTRY_DSN: '',
  VITE_BUILD_SENTRY_ORG: '',
  VITE_BUILD_SENTRY_PROJECT: '',
  VITE_BUILD_SENTRY_AUTH_TOKEN: '',
}

/** 与 `apps/admin/vite.config.ts` 同形，只把包名换成测试用的假名 */
function makeOptions(): ViteConfigPluginsOptions {
  return {
    pkg: {
      name: '@walnut/fake-admin',
      version: '0.0.0',
      description: 'plugin table test',
      author: { name: 'test' },
      homepage: 'https://example.com',
      dependencies: {},
    },
    isCustomElement: () => false,
    componentsDirs: ['src/components'],
    componentsDtsPath: 'types/generated/components.d.ts',
    componentsResolvers: [],
    iconify: {
      online: true,
      treeshake: false,
      customPrefix: 'w-svg',
      sets: ['ant-design'],
      scanPaths: ['src/**/*.{vue,ts,tsx}'],
      svgDir: '.svg',
    },
    checkerWatchPath: 'src',
  }
}

/** 插件表里可能嵌数组（legacy / sentry 的工厂返回数组），展平成 name 列表 */
function pluginNames(option: unknown): string[] {
  if (!option) {
    return []
  }
  if (Array.isArray(option)) {
    return (option as unknown[]).flatMap(pluginNames)
  }
  const name = (option as { name?: unknown }).name
  return typeof name === 'string' ? [name] : []
}

function namesFor(mode: string, overrides: Record<string, string> = {}): string[] {
  return pluginNames(createVitePlugins(mode, useBuildEnv({ ...BASE_ENV, ...overrides }), makeOptions()))
}

function legacyNames(names: string[]): string[] {
  return names.filter(name => name.startsWith('vite:legacy'))
}

describe('createVitePlugins 的开关型插件', () => {
  it('生产构建、开关全关时没有 CSP / legacy / Sentry', () => {
    const names = namesFor('production')

    expect(names).not.toContain(CSP_PLUGIN)
    expect(names).not.toContain(SENTRY_PLUGIN)
    expect(legacyNames(names)).toEqual([])
  })

  it('开关 VITE_BUILD_SENTRY=true 才挂 Sentry（回归锚：以前对对象求真、恒为真）', () => {
    const names = namesFor('production', {
      VITE_BUILD_SENTRY: 'true',
      VITE_BUILD_SENTRY_DSN: 'https://key@sentry.example/1',
      VITE_BUILD_SENTRY_ORG: 'walnut',
      VITE_BUILD_SENTRY_PROJECT: 'admin',
      VITE_BUILD_SENTRY_AUTH_TOKEN: 'token',
    })

    expect(names).toContain(SENTRY_PLUGIN)
  })

  it('开关 VITE_BUILD_CSP=true 才在生产构建里挂 CSP', () => {
    const names = namesFor('production', { VITE_BUILD_CSP: 'true' })

    expect(names).toContain(CSP_PLUGIN)
  })

  it('只开 VITE_DEV_CSP 时生产构建不挂 CSP', () => {
    const names = namesFor('production', { VITE_DEV_CSP: 'true' })

    expect(names).not.toContain(CSP_PLUGIN)
  })

  it('开发模式 VITE_DEV_CSP=true 才挂 CSP', () => {
    const names = namesFor('development', { VITE_DEV_CSP: 'true' })

    expect(names).toContain(CSP_PLUGIN)
  })

  it('只开 VITE_BUILD_CSP 时开发模式不挂 CSP', () => {
    const names = namesFor('development', { VITE_BUILD_CSP: 'true' })

    expect(names).not.toContain(CSP_PLUGIN)
  })

  it('开关 VITE_BUILD_LEGACY=true 才挂 legacy 的三支插件', () => {
    const names = namesFor('production', { VITE_BUILD_LEGACY: 'true' })

    expect(legacyNames(names)).toEqual(LEGACY_PLUGINS)
  })
})
