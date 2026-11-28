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
    // 已知问题（曾是偶发 TS1434 / TS1128 的来源）：真实 `vite build` 期间插件会**再写一次**这个文件，
    // 与构建自身的 TS 变换存在竞争 ⇒ 偶发解析错误（v0.1.4 的 Release 就这么红在 `Build admin`，
    // 而同一提交的 CI 因命中 turbo 缓存是绿的）。
    //
    // 为什么 `syncMode: 'append'`：`default` 在 **build** 时按 `overwrite` 语义写 —— 只把「已扫描到的
    // 组件」写进去，于是构建开头这个文件会先**缩成只有内置 resolver 那几条**（实测 22568 B → 606 B），
    // 再随 transform 增长。而 `vite-plugin-checker` 在 buildStart 就 spawn `vue-tsc --noEmit`，
    // 它可能读到缩小后的那一版：vue-tsc 3.3.14 把「`@vue-generic` 用在不含泛型的全局组件上」判成
    // TS2558（3.2.8 容忍，故以前只是偶发解析错误），一次 build 能报 31 条假红。
    // `append` = 与既有声明合并后再写，文件**永不缩小**；且 dev 侧 `default` 本来就是 append 语义
    // （`_removeUnused = syncMode === 'overwrite'`），所以这只是让 build 与 dev 一致。
    //
    // `append` 的代价（必须知道）：声明只增不减 ⇒ **删除 / 改名组件后 `components.d.ts` 会留下
    // 陈旧条目**，需要手动清理，或定期以 `default` 模式重生一次。它把「半写窗口」的概率大幅降低，
    // 但没有从机制上消除（真正的消除要等插件提供原子写入 / 单次 scan）。
    syncMode: 'append',
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
