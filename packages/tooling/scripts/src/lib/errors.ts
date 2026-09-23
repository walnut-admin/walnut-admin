/**
 * 三态退出码里「1 有违规」与「2 前置条件未满足」的表达面（只**表达**，不决定）。
 *
 * 为什么需要：这两种失败的下一步动作完全不同 —— 一个是改代码（检出违规），一个是修环境
 * （前置条件未满足），而它们若都用裸 `Error` 表达，「错误 → 退出码」就只能靠调用点各自 `instanceof`
 * 猜。具名之后，CLI 的顶层 catch 一处映射完：`ViolationError` → 1、`PreconditionError` → 2、
 * 其余未捕获的（`TypeError` / 语法错）算 1（脚本真的跑出问题了，不该让人去修不存在的前置条件）。
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
