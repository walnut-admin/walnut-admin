import type { ViteConfigPluginsOptions } from '../types.ts'
import Components from 'unplugin-vue-components/vite'

export function createComponentPlugin(options: ViteConfigPluginsOptions) {
  return Components({
    dirs: options.componentsDirs,

    extensions: ['vue', 'ts', 'tsx'],

    // allow auto import and register components used in markdown
    include: [
      /\.[tj]sx?$/, // .ts, .tsx, .js, .jsx
      /\.vue$/,
      /\.vue\?vue/, // .vue
      /\.md$/, // .md
    ],

    // 这份 dts 的**唯一产出者就是本插件**：调用方的 `pre*` 钩子只清理旧生成物，不再跑 stub 构建
    // 把它"种"出来。所以这里**不能**改成 `dts: false` —— 那样 `dev` / `build` 都不会再生成它
    // （2026-09-30 实测：删掉文件后跑一次 pre 钩子，文件不会回来）。
    //
    // 已知问题（未修，待方案）：真实 `vite build` 期间插件会**再写一次**这个文件，与构建自身的 TS
    // 变换存在竞争 ⇒ 偶发 `TS1434 Unexpected keyword or identifier` / `TS1128 Declaration or
    // statement expected`（v0.1.4 的 Release 就这么红在 `Build admin`，而同一提交的 CI 因命中
    // turbo 缓存是绿的）。
    dts: options.componentsDtsPath,

    // 显式打开 TSX 的全局声明块（`declare global { const NButton: ... }`）。
    // 插件的默认值是 `isPackageExists('@vitejs/plugin-vue-jsx')` —— 那是**从 cwd 的包清单里猜**，
    // 本包把插件依赖都装在自己名下之后就会猜成 false，生成的 dts 会**静默少一截**（实测：同一个
    // 应用搬到本包后 `For TSX support` 整段消失，应用里的 `.tsx` 不再有这些全局组件名）。
    dtsTsx: true,

    deep: false,

    // UI 库的 resolver 与调用方自有的前缀 resolver 都由调用方传入：本包不认识具体的 UI 库，
    // 也不扫任何 app 的组件目录
    resolvers: options.componentsResolvers,
  })
}
