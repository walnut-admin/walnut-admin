import type { ViteConfigPackageInfo, ViteConfigPluginsOptions } from '@walnut/vite-config'
import type { ComponentResolver } from 'unplugin-vue-components/types'
import type { ConfigEnv, UserConfig } from 'vite'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { createVitePlugins, createViteProxy, useBuildEnv } from '@walnut/vite-config'
import { globSync } from 'tinyglobby'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import { loadEnv } from 'vite'
import { envDir, publicDir } from './build/constant'
import { componentsDtsPath } from './build/utils/paths.ts'
import pkg, { dependencies } from './package.json'

function pathResolve(dir: string) {
  return resolve(__dirname, '.', dir)
}

/**
 * admin 的组件命名约定：`src/components/<分类>/<组件>/index.ts` 注册为 `W<组件>`。
 * 这是 app 自己的约定（不是 Vite 配置层的通用能力），所以 resolver 留在这里、经 options 传进去。
 */
function WalnutAdminComponentResolver(): ComponentResolver {
  // 扫描 admin 内部组件
  const allComponents = globSync('src/components/**/**/index.ts', { dot: true })
  const componentMap = Object.fromEntries(allComponents.filter(i => !i.includes('utils')).map(i => [i.split('/').slice(-2, -1)[0], i.replace('src', '@')]))

  return {
    type: 'component',
    resolve: (name) => {
      if (name.startsWith('W')) {
        const componentName = name.slice(1)

        if (componentMap[componentName]) {
          return componentMap[componentName]
        }
      }
    },
  }
}

/** 只把构建产物真正用到的字段交给 @walnut/vite-config（banner / 日志前缀 / 分包名） */
const packageInfo: ViteConfigPackageInfo = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  author: { name: pkg.author.name },
  homepage: pkg.homepage,
  dependencies: pkg.dependencies,
}

const pluginOptions: ViteConfigPluginsOptions = {
  pkg: packageInfo,

  // cropperjs 与 cap.js 的组件是浏览器里的原生自定义元素，Vue 模板编译器不该把它们当组件解析
  isCustomElement: tag => tag.startsWith('cropper-') || tag === 'cap-widget',

  // 组件自动注册（unplugin-vue-components）：目录、dts 路径与 resolver 都是 app 的约定
  componentsDirs: ['@/components'],
  componentsDtsPath,
  componentsResolvers: [
    // Naive
    NaiveUiResolver(),

    // Custom
    WalnutAdminComponentResolver(),
  ],

  iconify: {
    online: true,
    treeshake: false,
    customPrefix: 'w-svg',
    sets: ['ant-design', 'mdi', 'simple-icons', 'carbon', 'emojione-v1'],
    scanPaths: ['src/**/*.{vue,ts,tsx}'],
    svgDir: '.svg',
  },

  // `watchPath` 相对 vite root 解析；默认的 root 会把 node_modules 一起看
  checkerWatchPath: 'src',
}

// https://vitejs.dev/config/
export default ({ mode }: ConfigEnv): UserConfig => {
  const root = cwd()

  const env = loadEnv(mode, envDir)

  const processedEnv = useBuildEnv(env)

  return {
    root,
    appType: 'spa',

    base: processedEnv.publicPath,
    envDir,
    publicDir,

    define: {
      // https://vue-i18n.intlify.dev/guide/advanced/optimization#feature-build-flags
      '__VUE_I18N_FULL_INSTALL__': false,
      '__VUE_I18N_LEGACY_API__': false,
      // https://github.com/fi3ework/vite-plugin-checker/issues/569
      // https://github.com/vuejs/core/issues/13202#issuecomment-2804421417
      'process.env.NODE_ENV': JSON.stringify('production'),
    },

    plugins: [...createVitePlugins(mode, processedEnv, pluginOptions)],

    resolve: {
      // `resolve.conditions` 是**替换**而不是追加（V13 的根因，2026-09-29）：
      // 只写 `['source']` 会把 Vite 默认的 `module` / `browser` / `development|production` 一起抹掉，
      // 于是**每个 `exports` 映射里没有 `source` 分支的依赖都会落到 `default`**。tslib 正是如此：
      // 2.3.0 的 `exports` 里 `import` 指 ESM、`default` 指 UMD（`tslib.js`），conditions 被抹掉后
      // 解析到 UMD；而那份 UMD 自带 `__esModule` 标记 ⇒ 打包器不再合成 `default`，产物里就出现
      // 「从 undefined 的 `.default` 上解构 `__extends`」⇒ **生产包打开即崩**（留档 V13）。
      // 把默认值写回来即可，`source` 仍排在最前（workspace 包里声明了该条件的照旧直吃源码）。
      conditions: ['source', 'module', 'browser', 'development|production'],
      alias: {
        '@': pathResolve('src'),
        // https://github.com/axios/axios/issues/5000#issuecomment-1362395864
        'axios/lib': resolve(__dirname, './node_modules/axios/lib'),
      },
    },

    server: {
      host: processedEnv.host,

      port: processedEnv.port,

      proxy: createViteProxy(processedEnv),

      open: '/',

      hmr: {
        overlay: false,
      },
    },

    preview: {
      port: 8080,
      strictPort: true,
      host: true,
      open: true,
    },

    optimizeDeps: {
      // workspace 包有 source 条件直接消费源码，不应预构建
      include: Object.keys(dependencies).filter(i => !i.startsWith('@walnut/')),
    },

    build: {
      // 不写 minify：Vite 8 的默认值就是 'oxc'（仓内没有 esbuild 依赖，显式写 'esbuild'
      // 只会制造第二个真源）。dropConsole / dropDebugger 只在下面 rolldownOptions.output.minify
      // 这一处表达。
      outDir: processedEnv.build.outDir,
      // 显式声明而不是依赖 Vite 的启发式（outDir 在 root 内才默认清空）：产物目录必须每次
      // 构建都是「本次输出」，不能混入上一版残留的 hash chunk。注意它只罩**真跑构建**这一半；
      // turbo 缓存命中不走 Vite，由 turbo.json 的 clean:build（prod 的 dist）/ clean:stage
      // （dist-staging）两条 cache:false 任务先清目录。
      emptyOutDir: true,
      reportCompressedSize: false,
      // code split would caused build css not work
      cssCodeSplit: false,
      target: 'esnext',
      sourcemap: processedEnv.build.sentry.enabled,

      // Vite 8: rollupOptions 已更名为 rolldownOptions
      // 兼容层会自动转换，但建议显式迁移
      rolldownOptions: {
        output: {
          format: 'es',
          // https://github.com/vitejs/vite-plugin-vue/issues/19#issuecomment-3087602546
          chunkFileNames: (assetInfo: { name: string }) => {
            const name = assetInfo.name.endsWith('.vue_vue_type_style_index_0_lang')
              || assetInfo.name.endsWith('.vue_vue_type_script_setup_true_lang')
              ? assetInfo.name.split('.')[0]
              : assetInfo.name
            return `static/js/${name}-[hash].js`
          },
          entryFileNames: 'static/js/[name]-[hash].js',
          assetFileNames: 'static/[ext]/[name]-[hash].[ext]',

          // Vite 8: Rolldown 默认使用 onlyExplicitManualChunks 行为
          // manualChunks 在 Rolldown 中通过 codeSplitting 配置
          codeSplitting: {
            groups: [
              {
                name: 'vendor',
                test: /[\\/]node_modules[\\/]/,
              },
            ],
          },

          minify: processedEnv.build.dropConsole
            ? {
                compress: {
                  dropConsole: true,
                  dropDebugger: true,
                },
              }
            : undefined,
        },
      },
    },
  }
}
