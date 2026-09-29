/**
 * 手写 `.d.ts` 的类型检查：**关掉 `skipLibCheck`，只报我们自己的文件**。
 *
 * ## 为什么需要这条门禁（2026-09-29 实测）
 *
 * `skipLibCheck: true` 跳过的是**全部** `.d.ts` —— 不只是 `node_modules`，**也包括我们自己写的那十几份**。
 * 于是手写 `.d.ts` 里任何解析不了的写法都**静默退化成 `any`**，错误只在**消费方**漏出来，而且长得
 * 完全不像根因。
 *
 * 这次移除 `unplugin-auto-import` 就是被它咬的：`src/store/types.d.ts` 用了 `Ref<…>` 却从没 import 过
 * （借的是插件那份 dts 的全局类型再导出）。插件一走，这里**一个错误都不报**，报出来的是
 * `src/store/modules/user/user-scroll.ts(24,51): error TS7006: Parameter 'i' implicitly has an 'any' type.`
 * —— 排查它花的力气，比加这条门禁多得多。
 *
 * ## 首跑抓到的 16 处诊断 / 6 个文件（全部已修）
 *
 * 两处 PWA 残留（`/// <reference types="vite-plugin-pwa/client|vue" />` 与一个
 * `declare module 'virtual:pwa-register/vue'`，PWA 2026-08-08 就移除了）、`web-vitals` 改名后的
 * `FIDMetric`、`declare global` 里多余的 `declare`（TS1038）、把命名空间当类型用的 `echarts: ECharts`、
 * `interface IStorageAsync extends Exclude<Storage, …>`（`Exclude` 只作用于联合类型，接口上等于没写，
 * 应当是 `Omit`）、`interface HTMLAttributes extends HTMLAttributes`（自己继承自己，TS2310）、
 * `Recordable` 没 import 就用（4 处）、一个指向**从未在仓里存在过**的模型
 * （`IModels.SystemLogOperateDevice`）的类型引用，以及两处只有这条门禁能看见的
 * `@types/gtag.js` 误用（把全局类型包当成模块 import；`Gtag.DataLayer` 这个成员在包里根本不存在，
 * 而仓里也零处用它）。
 *
 * 这 16 处没有一个曾是「红的」—— 它们全被 `skipLibCheck` 藏住了。
 *
 * ⚠️ 顺带实测到一件**不属于本门禁**的事：关掉 `skipLibCheck` 后
 * `src/components/Vendor/ECharts/on-demand.ts` 会报 echarts 的双身份错误（`echarts` 的 UMD 全局与
 * `echarts/core` 模块各有一套 `_setting` 私有属性 ⇒ 互不兼容）。删掉我们自己的 `Window.echarts`
 * 声明它**依然存在** ⇒ 是上游形状问题，不是我们该修的。**这也是「不能全局关掉 `skipLibCheck`」的
 * 具体原因**；本门禁只收 `.d.ts`（见 `isOwnFile`），把它留在范围外。
 *
 * ## 判据：只报仓库内、且不在 `node_modules` 里的诊断
 *
 * 关掉 `skipLibCheck` 会连依赖的 `.d.ts` 一起查，实测**15 条错误全部来自依赖**
 * （`@vueuse/core` / `naive-ui` / `vue-i18n` / `@vue/compiler-core` / `unplugin-info` …）。
 * 那不是我们的代码，修不了 —— 一个开始报「你改不了的错」的门禁等于没有门禁。所以按**路径**过滤：
 * 仓库内、且路径段里没有 `node_modules` 的诊断才算违规（`isOwnFile`）。
 *
 * 工程配置在同目录的 `apps/admin/tsconfig.dts.json`（只收 `.d.ts` + 关 `skipLibCheck` 的理由写在
 * 那份 JSONC 的注释里）。
 */

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 被检查的工程（相对仓库根） */
export const DTS_PROJECT = 'apps/admin/tsconfig.dts.json'

/** 门禁只认这三种来源的诊断（与 `ts.Diagnostic` 解耦，好写用例） */
export interface DtsDiagLike {
  file: string | undefined
  /** 1-based；拿不到位置时为 0 */
  line: number
  message: string
}

export interface DtsFinding {
  file: string
  line: number
  message: string
}

/**
 * 这条诊断是不是「我们自己的**声明文件**」上的。**纯函数**（`root` 可注入，用例好写）。
 *
 * 判据三条：
 *   ① 以 `.d.ts` 结尾 —— 门禁只管手写声明文件。`.d.ts` 里的 `import` 会把普通 `.ts` 一起拉进
 *      program，那些文件上可能报出**只有关掉 `skipLibCheck` 才成立**的库身份问题（实测
 *      `echarts` 的 `_setting` 私有属性双身份），那不是这条门禁要管的事；
 *   ② 在仓库内（`path.relative` 不以 `..` 开头）；
 *   ③ 路径段里没有 `node_modules` —— 不能省：pnpm 的 workspace symlink 会让依赖的真实路径落在
 *      `node_modules/.pnpm/**`，而 `.d.ts` 里的 `import` 解析结果正是那条路径。
 */
export function isOwnFile(fileName: string | undefined, root: string = REPO_ROOT): boolean {
  if (fileName === undefined)
    return false
  if (!fileName.endsWith('.d.ts'))
    return false
  const rel = path.relative(root, fileName).replace(/\\/g, '/')
  if (rel.startsWith('..'))
    return false
  return !rel.split('/').includes('node_modules')
}

/** 只留我们自己的文件上的诊断。**纯函数**（`root` 可注入），用例直接喂它。 */
export function ownFindings(diags: readonly DtsDiagLike[], root: string = REPO_ROOT): DtsFinding[] {
  return diags
    .filter(d => isOwnFile(d.file, root))
    .map(d => ({ file: d.file as string, line: d.line, message: d.message }))
}

/** `ts.Diagnostic` → 解耦后的形状（带 1-based 行号） */
export function toDiagLike(d: ts.Diagnostic): DtsDiagLike {
  const message = ts.flattenDiagnosticMessageText(d.messageText, ' ')
  if (d.file === undefined || d.start === undefined)
    return { file: d.file?.fileName, line: 0, message }
  const { line } = d.file.getLineAndCharacterOfPosition(d.start)
  return { file: d.file.fileName, line: line + 1, message }
}

export function main(): void {
  const configPath = path.join(REPO_ROOT, DTS_PROJECT)
  if (!fs.existsSync(configPath))
    throw new PreconditionError(`找不到 ${DTS_PROJECT} —— 拒绝把「读不到东西」当绿灯`)

  const read = ts.readConfigFile(configPath, f => fs.readFileSync(f, 'utf8'))
  if (read.error !== undefined)
    throw new PreconditionError(`${DTS_PROJECT} 读不出来：${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`)

  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath))
  if (parsed.fileNames.length === 0)
    throw new PreconditionError(`${DTS_PROJECT} 一个文件都没包含进来 —— 拒绝把「扫不到东西」当绿灯`)

  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const findings = ownFindings(ts.getPreEmitDiagnostics(program).map(toDiagLike))

  out(`手写 .d.ts 检查：${parsed.fileNames.length} 个文件（skipLibCheck 关掉；依赖 .d.ts 的诊断不计）`)

  if (findings.length === 0) {
    line('ok', '我们自己的 .d.ts 零错误 —— 没有被 skipLibCheck 藏起来的静默 any')
    return
  }

  for (const f of findings)
    lineErr('violation', `${path.relative(REPO_ROOT, f.file).replace(/\\/g, '/')}:${f.line}\n    ${f.message}`)
  err(`\n共 ${findings.length} 处。这些错误平时被 skipLibCheck 藏住，症状会跑到**消费方**去。`)
  throw new ViolationError(`手写 .d.ts 有 ${findings.length} 处类型错误（明细见上）`)
}
