/**
 * 生成 `unplugin-vue-components` 的声明文件（`types/generated/components.d.ts`）。
 *
 * **为什么必须有这一步**：这份 dts 以前是**提交进仓**的（在 `types/*.d.ts`），所以
 * `pnpm dev` 每次重写都会把工作区弄脏 —— 而且 `.gitignore` 里那两条规则因为「带斜杠的模式
 * 锚定到仓库根」**根本没生效**（`git check-ignore` 无输出），于是它们既没被忽略、又被跟踪。
 * 移出跟踪面（改到 `types/generated/` + 正确的 ignore 规则）之后，**干净检出里没有它**，
 * 而 `types:check`（vue-tsc）要靠它声明全局组件 ⇒ 必须显式生成，否则新克隆 / CI 上类型检查
 * 会以「找不到 W 系组件」的方式失真（注意：`vueCompilerOptions.strictTemplates` 未开，
 * 组件解析不到时 vue-tsc **不报错**，所以「没生成」这件事只能靠这一步本身来保证）。
 *
 * **实现**：走的是**和 dev / build 完全同一份插件配置**
 * （`build/vite/plugin/component.ts`），只是用一次 `write: false` 的极小
 * vite build 触发它的扫描与写盘：
 *   · 入口是内联的虚拟模块（`virtual:dts-gen`）—— 不需要任何真实文件；
 *   · `write: false` ⇒ 不产出任何构建产物，唯一副作用是插件把 dts 写出来。
 *
 * 由 `pretypes:check` 调用（`dev` / `build` 本来就跑 vite，插件自己会写，不用重复跑）。
 */
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'vite'

import { componentsDtsPath, legacyAutoImportDtsPath } from '../utils/paths.ts'
import { createComponentPlugin } from '../vite/plugin/component.ts'

/** 从**本文件位置**推根，不看 cwd —— 这个脚本也会被 `pre*` 钩子以外的方式调用（手跑、调试） */
const root = resolve(import.meta.dirname, '../..')
const STUB = 'virtual:dts-gen'

/** 生成组件声明（由 `build/generate/index.ts` 统一调用） */
export async function generateTypeDeclarations() {
  // **先清理已废除的生成物**（`unplugin-auto-import` 于 2026-09-29 移除，见 ADR 0020）。
  //
  // 为什么必须在这一步机械地删，而不是写在文档里让人自己删：那份 dts 是 **gitignored** 的 ——
  // `git pull` 到这次改动时，它**不会被删掉**（git 不管未跟踪文件），而 `tsconfig.json` 的
  // include 是 `types/generated/*.d.ts` 这种**通配**：旧文件一旦留着，它那 403 行
  // `declare global { const … }` 就**继续生效** ⇒ 漏 import 也不报错、`vue-tsc` 假绿。
  // 生成步骤是每个 `vite` / `vue-tsc` 入口的必经之处（`lint:pre-hooks` 门禁守），放在这里即自愈。
  rmSync(resolve(root, legacyAutoImportDtsPath), { force: true })

  await build({
    configFile: false,
    root,
    logLevel: 'warn',

    // 与 vite.config.ts 里的别名保持一致（`@` → src）
    resolve: {
      alias: {
        '@': resolve(root, 'src'),
      },
    },

    plugins: [
      {
        name: 'dts-gen-stub-entry',
        resolveId: (id: string) => (id === STUB ? `\0${STUB}` : null),
        load: (id: string) => (id === `\0${STUB}` ? 'export {}\n' : null),
      },
      createComponentPlugin(),
    ],

    build: {
      write: false,
      rollupOptions: { input: STUB },
    },
  })

  console.log(`生成完成：${componentsDtsPath}（生成物，不进 git）`)
}
