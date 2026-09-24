/**
 * CLI 入口的**唯一形态**：bins 只写 `await runCli(main)`，别的什么都不写。
 *
 * ## 它收敛的是什么
 *
 * 在这之前，每个 bin 都是一行 `process.exit(main())`，而每个 `main()` 各自
 * `console.error(...)` + `return 1` / `return 2` —— 于是**「哪一类失败 → 哪个退出码」这件事
 * 被抄了十几遍**，且抄法还不一致（有的地方 catch 住自己算，有的地方直接把 2 当返回值）。
 * 现在：
 *
 * | 抛什么 | 退出码 | 含义 |
 * |---|---|---|
 * | 什么都不抛（正常返回） | **0** | 通过 |
 * | `ViolationError` | **1** | 查出违规（改代码就能过） |
 * | `PreconditionError` | **2** | 前置条件未满足（先修环境再重跑） |
 * | 其它（`TypeError` / 语法错） | **1** | **脚本自己**跑出问题了 —— 不该让人去修一个不存在的前置条件 |
 *
 * ## 两个刻意的选择
 *
 * 1. **用 `process.exitCode` 而不是 `process.exit()`**。`process.exit()` 会在异步的 stdout
 *    还没冲刷时就切断进程（POSIX 管道下真实存在）；设 `exitCode` 则让 Node 自然收尾。
 *    `log.ts` 在管道下本来就走同步写（`fs.writeSync`），两条路都堵上了。
 *    ⚠️ 代价要记住：`exitCode` 不会**强行**结束进程 —— 谁的 `main()` 留着没关的句柄
 *    （定时器 / 连接 / 未 await 的子进程），就会挂住。本仓的 bins 全是同步或 await 完才返回，
 *    没有这种句柄；**新写 bin 时别留悬空句柄**。
 * 2. **结语由这里打、明细由门禁打**。门禁把「哪一条违规」打到 stderr（它有结构化的 findings），
 *    然后抛 `ViolationError('X 有 N 处问题')` —— 那一句由本模块统一成
 *    `✖ X 有 N 处问题`，于是**所有门禁的最后一行长得一样**。前置条件同理。
 *
 * 不做什么：不解析 argv（各命令自己的事）、不认识业务、不捕获 `process.exit()` 调用。
 */

import process from 'node:process'

import { PreconditionError, ViolationError } from './errors.ts'
import { lineErr } from './log.ts'

/** 一个 CLI 命令的主体：正常返回即通过；失败**抛**，不要自己定退出码 */
export type CliMain = () => number | void | Promise<number | void>

/** 跑一个 CLI 命令，把结果映射成退出码（映射规则见文件头那张表） */
export async function runCli(main: CliMain): Promise<void> {
  try {
    const returned = await main()
    // 兼容「main 返回 0」的老写法；返回非 0 的写法已被淘汰（失败要抛）
    process.exitCode = typeof returned === 'number' ? returned : 0
  }
  catch (error) {
    if (error instanceof PreconditionError) {
      lineErr('violation', `前置条件未满足：${error.message}`)
      process.exitCode = 2
      return
    }
    if (error instanceof ViolationError) {
      lineErr('violation', error.message)
      process.exitCode = 1
      return
    }
    // 其余一律 1：这是**脚本自己**出问题，不是让人去修前置条件
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    lineErr('violation', `脚本自己出错了（这不是检出违规，是本工具的问题）：\n${message}`)
    process.exitCode = 1
  }
}
