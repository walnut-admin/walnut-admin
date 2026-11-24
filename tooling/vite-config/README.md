# `@walnut/vite-config` —— 共享 Vite 配置层

> 2026-11（阶段 6）从 `apps/admin/build/` 抽出。插件表、开发代理、环境变量 schema 与构建期读写
> 工具搬到本包；admin 只留自己的 codegen、常量与路径。
> 决策与否决项见 [ADR 0030](../../apps/docs/src/zh-CN/content/adr/0030-admin-build-config-as-tooling-package.md)。

## 它提供什么

| 能力 | 入口 | 说明 |
|------|------|------|
| 插件表 | `createVitePlugins(mode, env, options)` | 开发 / 生产分组的完整插件数组；开关型插件由 `env` 决定 |
| 开发代理 | `createViteProxy(env)` | `/api` 与 websocket 两条代理，开关来自 `VITE_PROXY` 的 JSON |
| 环境变量 schema | `devEnvSchema` / `stageEnvSchema` / `prodEnvSchema` | zod schema，交给 `@julr/vite-plugin-validate-env` 做启动校验 |
| env 映射 | `useBuildEnv(env)` | `loadEnv()` 的字符串表 → `IViteEnv`（插件表与代理的输入） |
| 环境变量类型 | `ViteImportMetaEnv` / `IViteEnv` | 前者供 app 接到全局 `ImportMetaEnv`，后者是映射结果的形状 |
| 构建期读写 | `@walnut/vite-config/utils` 的 `BuildUtilsReadFile` / `BuildUtilsWriteFile` | `fs.readFile` / `fs.writeFile` 加一行日志，末尾补 EOL |
| 构建期日志 | `@walnut/vite-config/utils` 的 `BuildUtilsLog` / `configureBuildLogger` | 带包名前缀的一行日志；前缀由 `configureBuildLogger` 设一次（`createVitePlugins` 会替插件链路设） |

## 怎么消费

`apps/admin` 的真实写法（节选，完整文件见 `apps/admin/vite.config.ts`）：

```ts
import type { ViteConfigPackageInfo, ViteConfigPluginsOptions } from '@walnut/vite-config'
import type { ConfigEnv, UserConfig } from 'vite'
import { createVitePlugins, createViteProxy, useBuildEnv } from '@walnut/vite-config'
import { loadEnv } from 'vite'
import { envDir, publicDir } from './build/constant'
import { componentsDtsPath } from './build/utils/paths.ts'
import pkg, { dependencies } from './package.json'

const pluginOptions: ViteConfigPluginsOptions = {
  pkg: {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: { name: pkg.author.name },
    homepage: pkg.homepage,
    dependencies: pkg.dependencies,
  },
  isCustomElement: tag => tag.startsWith('cropper-') || tag === 'cap-widget',
  componentsDirs: ['@/components'],
  componentsDtsPath,
  componentsResolvers: [NaiveUiResolver()],
  iconify: { online: true, treeshake: false, customPrefix: 'w-svg', sets: ['ant-design', 'mdi'], scanPaths: ['src/**/*.{vue,ts,tsx}'], svgDir: '.svg' },
  checkerWatchPath: 'src',
}

export default ({ mode }: ConfigEnv): UserConfig => {
  const processedEnv = useBuildEnv(loadEnv(mode, envDir))

  return {
    base: processedEnv.publicPath,
    envDir,
    publicDir,
    plugins: [...createVitePlugins(mode, processedEnv, pluginOptions)],
    server: {
      host: processedEnv.host,
      port: processedEnv.port,
      proxy: createViteProxy(processedEnv),
    },
    // 其余是 app 自己的构建策略（alias / optimizeDeps / rolldownOptions …）
  }
}
```

独立脚本要日志时，先设一次前缀再调工具（`createVitePlugins` 会替插件链路做这一步）：

```ts
import { BuildUtilsLog, configureBuildLogger } from '@walnut/vite-config/utils'
import pkg from '../package.json' with { type: 'json' }

configureBuildLogger(pkg.name)
BuildUtilsLog('Generating JSON schemas')
```

## 插件开关类环境变量

除 `VITE_PROXY` 这类必填项外，插件表还有几个开关型变量。**布尔量只认字面量 `true`**（见
`useBuildEnv`），写成其它值一律按关处理。

| 变量 | 作用域 | 说明 |
|------|--------|------|
| `VITE_DEV_CSP` | 仅 dev | 开发时给 dev server 注入 Content-Security-Policy 的 meta（插件自带的 dev 模式），用来在浏览器控制台里直接看违规，不必构建 |
| `VITE_BUILD_CSP` | 生产 / 预发构建 | 构建时把 CSP 写进 `index.html`；**可选键，不配就是关** |
| `VITE_BUILD_LEGACY` | 生产 / 预发构建 | 生成旧浏览器兼容包与 SystemJS 加载器；**可选键，不配就是关**，体积明显变大 |
| `VITE_BUILD_SENTRY` | 生产 / 预发构建 | 是否挂上 Sentry 插件（上传 sourcemap）；`VITE_BUILD_SENTRY_*` 是一组必填配套键 |

dev 与 build 两侧**各看各的开关**：开 `VITE_DEV_CSP` 不会让生产构建带上 CSP，反之亦然。
`VITE_BUILD_CSP` / `VITE_BUILD_LEGACY` 在 schema 里是 `optional()`，因为密文 env 模板没有这两个键，
而启动校验对「键不存在」是硬报错；要启用就在对应 env 文件或进程环境里补一行。

## 契约与扩展点

### 为什么这些值由调用方传

本包不 import 任何 app 文件，也不读任何一个 `package.json`。`ViteConfigPluginsOptions` 的每个字段
都是「只有 app 才知道」的事实：

| 字段 | 为什么不能由本包决定 |
|------|----------------------|
| `pkg` | banner / 日志前缀 / 分包名要用**调用方**的名字与版本；本包没有「当前 app」这个概念 |
| `isCustomElement` | 哪些标签是浏览器原生自定义元素，取决于 app 用了哪些 web component 库 |
| `componentsDirs` / `componentsDtsPath` / `componentsResolvers` | 组件目录、dts 落点、`W<组件>` 前缀与 UI 库 resolver 都是 app 的约定 |
| `iconify` | 图标集、扫描范围、自定义 SVG 目录由 app 决定 |
| `checkerWatchPath` | `vite-plugin-checker` 的 `watchPath` 相对 vite root 解析，只有调用方知道源码目录 |

### 加一个插件

1. 在 `src/plugins/<name>.ts` 导出 `createXxxPlugin(...)`，参数只收它真正需要的值（需要 app 信息就
   从 `ViteConfigPluginsOptions` 里扩，不要在本包里 import app 文件）；
2. 在 `src/plugins/index.ts` 的 `createVitePlugins` 里按「基础 / dev / prod」三组插进去，prod 的开关
   一律读 `env.build.*`；
3. 新依赖进 `pnpm-workspace.yaml` 的 `catalog:`，本包 `package.json` 写 `catalog:`。别在调用方的
   `vite.config.ts` 里直接 import —— 那等于把插件的安装位置又拆成两处。

### 加一个环境变量

三处要一起想清楚：

1. **schema**：`src/env/env.<mode>.ts`；多个 mode 共用就放 `src/env/shared.ts` 的工厂函数。dev / stage
   允许不配的键要在该 mode 的 schema 里显式 `optional()`（shared 里必填的键不会自动放宽）。
2. **映射**：要进运行期结构就往 `src/env/use-build-env.ts` 与 `src/env/types.ts` 加；纯构建开关直接让
   插件读 `env.build.*`。
3. **类型**：`ViteImportMetaEnv` 只取 development 与 stage 两份 schema 的并集（历史口径，prod 不在内）
   —— 加了键就自动出现在 `import.meta.env` 的类型里，app 侧 `types/vite-env.d.ts` 不用改
   （它只把 `ViteImportMetaEnv` 接到全局 `ImportMetaEnv`）。进 schema 的键还要在
   `apps/admin/env-encrypted/` 的对应密文里补上值，否则启动校验会红。

## 已知限制

- **由 Vite 的配置加载链路经 Node 原生类型剥离执行**：`exports` 指向 `./src/**`，Vite 最终
  `import()` 的就是这些 `.ts`。所以 tsconfig 走 `ts.json`（`erasableSyntaxOnly`），包内相对 import
  一律带 `.ts` 扩展名，不能用 `enum` / `namespace` / 参数属性这类剥不掉的语法。
- **有些依赖必须同时留在 app 侧**：
  - `@iconify/vue` 与 `@iconify/json`：dev 模式的虚拟模块里写的是 `import … from '@iconify/vue'` /
    `'@iconify/json/json/<set>.json'`，这些 import 由**app 的模块图**解析；只装在本包里，虚拟模块会
    解析失败；
  - `unplugin-info` / `unplugin-turbo-console`：app 的 `types/vite-refs.d.ts` 用
    `/// <reference types="…/client" />` 引用它们的 client 类型，类型解析要从 app 出发。
- **`dtsTsx: true` 是显式写死的**：`unplugin-vue-components` 的默认值是
  `isPackageExists('@vitejs/plugin-vue-jsx')` —— 它从 **cwd 的包清单**里猜。插件依赖装到本包名下之后，
  这个猜测会静默变成 `false`，生成的 `components.d.ts` 会少掉 `For TSX support` 整段。别改回默认值。
- **日志前缀是模块级状态**（`configureBuildLogger`）：`createVitePlugins` 会按调用方的包名设一次；
  一个进程里同时给两个 app 建配置会互相覆盖。取这个折中是刻意的 —— 调用点分散在插件深处
  （iconify、`fs` 工具），逐个传包名只会给纯工具函数加一个与它职责无关的参数。
- **`VITE_BUILD_LEGACY` 目前打不开生产构建**（2026-11-24 实测）：`plugin-legacy` 把目标环境解析成
  含 `es2020` 的一组浏览器，而 admin 的 `src/store` 里有顶层 `await`（`useAppStorageAsync`），
  esbuild 的 legacy 转换因此报 `Top-level await is not available in the configured target environment`。
  开关本身接通了，只是这条链路要等 app 侧去掉顶层 await 或调整 legacy 目标后才可用。
