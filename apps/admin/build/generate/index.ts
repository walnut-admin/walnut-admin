/**
 * 生成物统一入口 —— `predev` / `prebuild` / `prebuild:stage` / `pretypes:check` 都跑它。
 *
 * ## 组件声明（`types/generated/components.d.ts`）是**提交进仓**的，这里不再生成
 *
 * 2026-09-30 改：这份 dts 由 `unplugin-vue-components` 在**真实** dev / build 期间扫描出来并写出，
 * 我们把它纳入 git 跟踪（见 `.gitignore` 里那条按文件的例外）。于是：
 *
 *   · 干净检出 / 换台电脑：文件本来就在 ⇒ `pnpm dev`、`vue-tsc` 开箱可用（硬要求）；
 *   · 插件写盘判据是 `if (code !== originalContent)` ⇒ 组件集合没变时**它根本不写** ⇒
 *     与 checker 的竞争消失（v0.1.4 的 `TS1434 / TS1128` 就是读到半写文件导致的 flaky）；
 *   · 组件集合变了 ⇒ 插件在 dev / build 期间更新它 ⇒ 跟代码一起提交，忘了提交由 CI 拦住。
 *
 * 以前这里会跑一次 `write: false` 的 stub 构建把 dts"种"出来（干净检出里没有它时的兜底）。
 * 文件进仓之后那一步只剩坏处：stub 入口解析不到任何组件 ⇒ 把完整声明**重置成 24 行骨架**，
 * 每次构建都多一次写盘、竞争窗口重现（实测：连续两次构建内容相同，mtime 却都变了）。
 * **别再把它加回来。**
 */
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

import { legacyAutoImportDtsPath } from '../utils/paths.ts'
import { generateJSONSchemas } from './genJSONSchemas.ts'

/**
 * 已废除生成物的自愈清理（`unplugin-auto-import` 于 2026-09-29 移除，见 ADR 0020）。
 *
 * 为什么必须机械地删，而不是写在文档里让人自己删：那份 dts 是 **gitignored** 的 —— `git pull`
 * 到这次改动时它**不会被删掉**（git 不管未跟踪文件），而 `tsconfig.json` 的 include 是
 * `types/generated/*.d.ts` 这种**通配**：旧文件一旦留着，它那 403 行 `declare global { const … }`
 * 就**继续生效** ⇒ 漏 import 也不报错、`vue-tsc` 假绿。生成步骤是每个 `vite` / `vue-tsc` 入口的
 * 必经之处（`lint:pre-hooks` 门禁守），放在这里即自愈。
 */
function removeLegacyGeneratedFiles() {
  rmSync(resolve(import.meta.dirname, '../..', legacyAutoImportDtsPath), { force: true })
}

async function main() {
  removeLegacyGeneratedFiles()
  await generateJSONSchemas()
}

// 不吞异常：失败时打出来并以非零退出（这一步挂了，后面的 vite / vue-tsc 必然红得更难懂）
main().catch((error: unknown) => {
  console.error('生成物生成失败：', error)
  process.exitCode = 1
})
