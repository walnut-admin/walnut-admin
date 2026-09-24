/**
 * 生成两个 unplugin 的声明文件（`types/generated/{auto-import,components}.d.ts`）。
 *
 * **为什么必须有这一步**：这两份 dts 以前是**提交进仓**的（在 `types/*.d.ts`），所以
 * `pnpm dev` 每次重写都会把工作区弄脏 —— 而且 `.gitignore` 里那两条规则因为「带斜杠的模式
 * 锚定到仓库根」**根本没生效**（`git check-ignore` 无输出），于是它们既没被忽略、又被跟踪。
 * 移出跟踪面（改到 `types/generated/` + 正确的 ignore 规则）之后，**干净检出里没有它们**，
 * 而 `types:check`（vue-tsc）要靠它们声明全局的 auto-import 与全局组件 ⇒ 必须显式生成，
 * 否则新克隆 / CI 上类型检查会以「找不到全局 API」红。
 *
 * **实现**：走的是**和 dev / build 完全同一份插件配置**
 * （`build/vite/plugin/{auto-import,component}.ts`），只是用一次 `write: false` 的极小
 * vite build 触发它们的扫描与写盘：
 *   · 入口是内联的虚拟模块（`virtual:dts-gen`）—— 不需要任何真实文件；
 *   · `write: false` ⇒ 不产出任何构建产物，唯一副作用是插件把 dts 写出来。
 *
 * 由 `pretypes:check` 调用（`dev` / `build` 本来就跑 vite，插件自己会写，不用重复跑）。
 */
import { resolve } from 'node:path'
import { build } from 'vite'

import { autoImportDtsPath, componentsDtsPath } from '../utils/paths.ts'
import { createAutoImportPlugin } from '../vite/plugin/auto-import.ts'
import { createComponentPlugin } from '../vite/plugin/component.ts'

/** ⚠️ 从**本文件位置**推根，不看 cwd —— 这个脚本也会被 `pre*` 钩子以外的方式调用（手跑、调试） */
const root = resolve(import.meta.dirname, '../..')
const STUB = 'virtual:dts-gen'

/** 生成两个 unplugin 的 dts（由 `build/generate/index.ts` 统一调用） */
export async function generateTypeDeclarations() {
  await build({
    configFile: false,
    root,
    logLevel: 'warn',

    // 与 vite.config.ts 里的别名保持一致（`@` → src、`~` → types）
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
        '~': resolve(root, 'types'),
      },
    },

    plugins: [
      {
        name: 'dts-gen-stub-entry',
        resolveId: (id: string) => (id === STUB ? `\0${STUB}` : null),
        load: (id: string) => (id === `\0${STUB}` ? 'export {}\n' : null),
      },
      createAutoImportPlugin(),
      createComponentPlugin(),
    ],

    build: {
      write: false,
      rollupOptions: { input: STUB },
    },
  })

  console.log(`✅ 生成完成：${autoImportDtsPath} / ${componentsDtsPath}（生成物，不进 git）`)
}
