/**
 * 生成物统一入口 —— `predev` / `prebuild` / `prebuild:stage` / `pretypes:check` 都跑它。
 *
 * **为什么每个入口都要先跑一遍**（2026-09-24 CI 实测踩到）：这两份 dts 从跟踪面移出去之后，
 * 干净检出里**没有**它们，而 **vite 的 checker 是在插件写盘之前就建好 TS program 的** ——
 * 于是 `Build admin` 会以一批 `Cannot find name 'useAppStore…'` 失败（本地同样能复现：
 * 把 `types/generated/` 移走再直接跑 `vue-tsc`，报的就是同一批名字）。
 * 以前没这个问题，纯粹是因为提交里躺着一份完整的 dts 替它兜着。
 *
 * ⚠️ 所以**凡是会启动 vite 或 vue-tsc 的脚本，都要先有这一步**（pnpm 的 `pre*` 钩子会跑它）；
 * 加新的生成物时加到这个文件里，别各写各的 `pre` 命令。
 */
import process from 'node:process'

import { generateJSONSchemas } from './genJSONSchemas.ts'
import { generateTypeDeclarations } from './genTypeDeclarations.ts'

async function main() {
  await generateJSONSchemas()
  await generateTypeDeclarations()
}

// 不吞异常：失败时打出来并以非零退出（这一步挂了，后面的 vite / vue-tsc 必然红得更难懂）
main().catch((error: unknown) => {
  console.error('生成物生成失败：', error)
  process.exitCode = 1
})
