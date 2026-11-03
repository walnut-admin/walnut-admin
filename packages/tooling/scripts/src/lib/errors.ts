/**
 * 四态退出码里「1 有违规」「2 前置条件未满足」「3 环境缺失、**未验证**」的表达面
 * （只**表达**，不决定）。
 *
 * 为什么需要：这几种失败的下一步动作完全不同 —— 改代码（检出违规）、修环境（前置条件未满足）、
 * 换台有工具的机器或把工具装上（未验证），而它们若都用裸 `Error` 表达，「错误 → 退出码」就只能
 * 靠调用点各自 `instanceof` 猜。具名之后，CLI 的顶层 catch 一处映射完：`ViolationError` → 1、
 * `PreconditionError` → 2、`SkippedError` → 3、其余未捕获的（`TypeError` / 语法错）算 1
 * （脚本真的跑出问题了，不该让人去修不存在的前置条件）。
 *
 * 为什么「未验证」（3）必须与「前置条件未满足」（2）分开：前者是**这一步压根没跑**（本机没装
 * actionlint / 没有 bash），后者是**跑了但前提不成立**（产物目录不存在）。并进同一个码之后，
 * 「跳过」会重新变成「失败」的近义词，于是所有人开始无视它 —— 而真正要的是
 * **跳过必须看得见、但默认不误伤**（消费方见 ci/prepush.ts 与 release 的发版电池）。
 * 失败口径：本模块只表达，不 `process.exit`、不打印、不认识任何业务。
 */

/** 前置条件未满足（环境 / 参数 / 输入没准备好，先修环境再重跑）→ 退出码 2 */
export class PreconditionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreconditionError'
  }
}

/** 检出违规（改代码就能过）→ 退出码 1 */
export class ViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ViolationError'
  }
}

/**
 * 环境缺失导致这一步**未验证**（不是通过，也不是违规）→ 退出码 3。
 *
 * 与 `PreconditionError` 的区别只在「跑没跑」：这里**一步都没跑**（探测不到工具），
 * 那里是跑了、前提不成立。退出码单独占一档，调用方才有可能把「未验证」与「通过」分开报出来
 * —— 它们若同码同形，推送者就分不清自己到底被验过没有。
 */
export class SkippedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkippedError'
  }
}

/** 未验证的退出码（`SkippedError` 的映射值）。**这里是唯一真源**，消费方别再写字面量 3 */
export const SKIPPED_EXIT_CODE = 3
