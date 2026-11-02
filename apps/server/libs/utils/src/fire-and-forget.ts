import type { Logger } from '@nestjs/common'

/**
 * @description 收编「发起后不再等待」的 Promise：把 rejection 就地吞进日志，**绝不让它变成
 * 进程级 unhandledRejection**（Node 24 默认 `--unhandled-rejections=throw`，一次 Redis/Bull
 * 抖动即整进程崩溃 —— F-05）。
 *
 * 用法：原本写 `void this.someService.fire()` 的地方改成
 * `fireAndForget(this.someService.fire(), this.logger, 'some context')`。
 * 调用时机与顺序**不变**：Promise 在调用点就已经被创建/发起，本函数只负责挂 catch。
 *
 * 设计约束：
 * 1. 返回 `void`（不是 Promise）—— 调用方不该 await 它，也不该再对返回值挂链；
 * 2. 只接受 `Pick<Logger, 'error'>` —— 不引入 Nest 运行时依赖，测试可传任意同形对象；
 * 3. 连 `logger.error` 自身抛错也被吞掉：日志器抖动不能反过来造出新的 unhandled rejection
 *    （那样本函数就失去了存在意义）。
 *
 * @param promise 已在调用点发起的 Promise（或 thenable）
 * @param logger 记日志的 Logger（可省；省略时静默吞掉，只保证不崩进程）
 * @param context 日志上下文，标明是哪一处后台任务失败（强烈建议传）
 */
export function fireAndForget(
  promise: Promise<unknown> | PromiseLike<unknown>,
  logger?: Pick<Logger, 'error'>,
  context?: string,
): void {
  // `Promise.resolve` 兼容 thenable（不假设入参一定是原生 Promise）
  void Promise.resolve(promise).catch((error: unknown) => {
    if (!logger)
      return

    try {
      logger.error(
        `[fireAndForget] ${context ?? 'background task'} rejected`,
        error instanceof Error ? error.stack : String(error),
      )
    }
    catch {
      // 日志器自身异常必须就地吞掉：否则 .catch 处理器抛错 → 新的 unhandled rejection
    }
  })
}
