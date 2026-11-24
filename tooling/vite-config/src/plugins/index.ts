import type { PluginOption } from 'vite'
import type { IViteEnv } from '../env/types.ts'
import type { ViteConfigPluginsOptions } from '../types.ts'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'

import devtoolsJson from 'vite-plugin-devtools-json'
import { configureBuildLogger } from '../utils/log.ts'
import { createBannerPlugin } from './banner.ts'
import { createCdnImportPlugin } from './cdn-import.ts'
import { createCheckerPlugin } from './checker.ts'
import { createComponentPlugin } from './component.ts'
import { createCompressionPlugin } from './compression.ts'
import { createCSPPlugin } from './csp.ts'
import { createDevtoolsPlugin } from './devtool.ts'
import { createDisableDevtoolPlugin } from './disable-devtool.ts'
import { createGoogleAnalyticsPlugin } from './google-analytics.ts'
import { createHttpsPlugin } from './https.ts'
import { createIconifyPlugin } from './iconify.ts'
import { createImageOptimizerPlugin } from './image-optimizer.ts'
import { createInfoPlugin } from './info.ts'
import { createLegacyPlugin } from './legacy.ts'
import { createObfuscatorPlugin } from './obfuscator.ts'
import { createRestartPlugin } from './restart.ts'
import { createSentryPlugin } from './sentry.ts'
import { createTurboConsolePlugin } from './turbo-console.ts'
import { createUnoCSSPlugin } from './unocss.ts'
import { createValidateEnvPlugin } from './validate-env.ts'
import { createVisualizerPlugin } from './visualizer.ts'

/**
 * 组装一个 app 的完整插件表。
 *
 * app 专属的东西（包名、Vue 自定义元素、组件目录与 resolver、iconify 扫描范围）全部来自 `options`；
 * 开关型插件由 `env`（即 `useBuildEnv` 的返回值）决定。本函数不认识任何一个具体 app。
 */
export function createVitePlugins(mode: string, env: IViteEnv, options: ViteConfigPluginsOptions) {
  const dev = mode === 'development'

  // 日志前缀的唯一来源：调用方把自己的包名交出来，本包不读任何 package.json
  configureBuildLogger(options.pkg.name)

  const vitePlugins: PluginOption = [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: options.isCustomElement,
        },
      },
    }),
    vueJsx(),

    // https://github.com/Julien-R44/vite-plugin-validate-env
    createValidateEnvPlugin(mode),

    // https://github.com/yjl9903/unplugin-info
    createInfoPlugin(),

    // https://github.com/unplugin/unplugin-vue-components
    createComponentPlugin(options),

    // https://github.com/unocss/unocss
    createUnoCSSPlugin(),

    // https://github.com/fi3ework/vite-plugin-checker
    createCheckerPlugin(options.checkerWatchPath),

    // custom plugin
    createIconifyPlugin(options.iconify),
  ]

  // CSP 安全头 —— **默认关**，两个开关各管一边：
  //   · 开发试错：VITE_DEV_CSP（插件自带的 dev 模式，给 dev server 的页面注入策略，违规直接在浏览器
  //     控制台里看到，不用构建）；
  //   · 构建：VITE_BUILD_CSP（可选键，不配就是关）。
  // 两边各看各的开关 —— 开发开着不该让构建也生效，反之亦然。
  // 这一段曾经因为下面两个上游 issue 被整段注释掉；2026-11-24 重新接回时在本机实测过：
  // dev 的页面 HTML 与生产构建的 dist/index.html 里都出现了 CSP 的 meta，日志无插件报错。
  // 再出问题先看这两个 issue 有没有新的进展。
  // https://github.com/tsotimus/vite-plugin-csp-guard/issues/265
  // https://github.com/vitejs/vite/issues/2377#issuecomment-2571422093
  const cspWanted = dev ? env.dev.csp : env.build.csp
  cspWanted && vitePlugins.push(createCSPPlugin(env))

  // https://analytics.google.com
  env.gaId && vitePlugins.push(createGoogleAnalyticsPlugin(env))

  // I'm pretty sure packages below will be removed when build
  // It's just a symbol to tell you that when this plugin will be used
  if (dev) {
    // https://github.com/ChromeDevTools/vite-plugin-devtools-json
    vitePlugins.push(devtoolsJson())

    // https://github.com/vuejs/devtools
    vitePlugins.push(createDevtoolsPlugin())

    // https://github.com/unplugin/unplugin-turbo-console
    vitePlugins.push(createTurboConsolePlugin(options.pkg.name))

    // https://github.com/antfu/vite-plugin-restart
    vitePlugins.push(createRestartPlugin())

    // https://github.com/liuweiGL/vite-plugin-mkcert
    vitePlugins.push(createHttpsPlugin())
  }
  else {
    // https://github.com/FatehAK/vite-plugin-image-optimizer
    vitePlugins.push(createImageOptimizerPlugin())

    // https://github.com/vitejs/vite/tree/main/packages/plugin-legacy
    // 旧浏览器兼容（VITE_BUILD_LEGACY，可选键、默认关）：会多产出一份 legacy 包和 SystemJS 加载器，
    // 体积明显变大，所以按需开。
    // 2026-11-24 实测：打开后 admin 的生产构建会失败 —— plugin-legacy 解析出的目标环境（含 es2020）
    // 与 `src/store` 里的顶层 await 不兼容，esbuild 报 `Top-level await is not available in the
    // configured target environment`。只记录现象，没有改插件内部逻辑。
    env.build.legacy && vitePlugins.push(createLegacyPlugin())

    // https://github.com/nonzzz/vite-plugin-cdn
    env.build.cdn && vitePlugins.push(createCdnImportPlugin())

    // https://github.com/nonzzz/vite-plugin-compression
    env.build.compression && vitePlugins.push(createCompressionPlugin())

    // https://github.com/z0ffy/vite-plugin-bundle-obfuscator
    env.build.obfuscator && vitePlugins.push(createObfuscatorPlugin(options.pkg))

    // https://github.com/chengpeiquan/vite-plugin-banner
    env.build.banner && vitePlugins.push(createBannerPlugin(env.build.outDir, options.pkg))

    // https://github.com/nonzzz/vite-bundle-analyzer
    env.build.analyzer && vitePlugins.push(createVisualizerPlugin(env.title))

    // https://github.com/theajack/disable-devtool
    env.build.disableBrowserDevtool && vitePlugins.push(createDisableDevtoolPlugin())

    // https://sentry.io
    // 读的是 enabled：sentry 是个对象，以前写 `env.build.sentry &&` 对对象恒为真 —— Sentry 插件每次
    // 生产构建都会挂上，VITE_BUILD_SENTRY 实际只控制了 sourcemap（2026-11-24 修正）。
    env.build.sentry.enabled && vitePlugins.push(createSentryPlugin(env))
  }

  return vitePlugins
}
