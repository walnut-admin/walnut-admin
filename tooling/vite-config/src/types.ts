import type { ComponentResolver } from 'unplugin-vue-components/types'
import type { IconifyPluginOptions } from './plugins/custom/iconify/types.ts'

/**
 * 调用方 `package.json` 里构建产物真正用到的字段。
 *
 * 只列用到的：banner 横幅用 name / version / description / author.name / homepage，
 * obfuscator 用 dependencies 生成 manualChunks 名，日志与 turbo-console 用 name。
 * 别为了「完整」把整个 package.json 塞进来 —— 那样本包就再次依赖调用方的清单形态。
 */
export interface ViteConfigPackageInfo {
  name: string
  version: string
  description: string
  author: { name: string }
  homepage: string
  /** `@scope/name` 会被拼成 `vendor-@scope`（历史口径，见 `createObfuscatorPlugin`） */
  dependencies: Record<string, string>
}

/**
 * 插件表的调用方选项。
 *
 * 这些值此前散落在 app 的 Vite 插件封装里写死（包名、Vue 模板的自定义元素、
 * 组件目录与 resolver、iconify 的扫描范围）。搬进本包后一律由调用方的 `vite.config.ts` 传入：
 * 本包不认识任何一个具体 app，也不 import 仓库里的任何 app 文件。
 */
export interface ViteConfigPluginsOptions {
  /** 调用方的包信息（横幅 / 分包名 / 日志前缀） */
  pkg: ViteConfigPackageInfo
  /** Vue 模板编译器把哪些标签当原生自定义元素（web components） */
  isCustomElement: (tag: string) => boolean
  /** `unplugin-vue-components` 的组件目录（相对 vite root，可用别名） */
  componentsDirs: string[]
  /**
   * `unplugin-vue-components` 的 dts 写出路径（相对 vite root）。
   *
   * **不能传 `false`**：这份 dts 的唯一产出者就是这个插件（`pre*` 钩子里的 codegen 只做清理，
   * 不再 stub 构建），关掉之后 dev / build 都不会再生成它。
   */
  componentsDtsPath: string
  /** 按需注册的组件 resolver（UI 库的 resolver、调用方自有的前缀 resolver 等） */
  componentsResolvers: ComponentResolver[]
  /** iconify 插件选项；`scanPaths` / `svgDir` 相对 vite root */
  iconify: IconifyPluginOptions
  /**
   * `vite-plugin-checker` 的 ESLint 监控路径（相对 vite root）。
   * 缺省 `src`：`watchPath` 是相对 vite root 解析的，写成带 `../` 的路径会指向不存在的目录、
   * 让 ESLint 只在启动时跑一次（历史事故，见 `createCheckerPlugin`）。
   */
  checkerWatchPath?: string
}
