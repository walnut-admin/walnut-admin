/**
 * 失败分类与退出码。
 *
 * 退出码只有三档（P2-1，README 的「退出码」一节是给人看的同一份口径）：
 *
 * - **0** 成功；
 * - **1** 跑起来了但结果不对（用例红、脚本自身 bug、无法判别的错误）；
 * - **2** **环境没准备好**（缺 env、缺 stage 产物、PG / Redis 不可达、端口被占）——
 *   这类失败重跑没有意义，先按报错里的提示把前置补上。
 *
 * 谁来折算：只有本包自己的进程入口（prepare-db / preflight / static-server / run 的 main）在
 * 顶层 catch 里调 {@link exitCodeForError}；**Playwright 的退出码原样透传**（那是它的契约，
 * 例如 1 = 有用例失败，不在这里改写）。
 */

/** 前置条件没满足 —— 顶层 catch 会把它折成退出码 2 */
export class E2ePreconditionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'E2ePreconditionError'
  }
}

/**
 * 子进程（migration / seed）的非零退出。
 *
 * `status === 2` 原样透传（那条子进程自己就是「环境没准备好」），其余非零折算成 1 ——
 * 300 之类的信号退出、或工具自己用的别的码，对我们都只有「失败」一个语义。
 */
export class E2eChildFailure extends Error {
  readonly exitCode: number

  constructor(label: string, status: number) {
    super(`[e2e] 子进程失败：${label}（exit ${status}）`)
    this.name = 'E2eChildFailure'
    this.exitCode = status === 2 ? 2 : 1
  }
}

export const EXIT_OK = 0
/** 跑起来了但结果不对 */
export const EXIT_FAILURE = 1
/** 环境没准备好 */
export const EXIT_PRECONDITION = 2

/** 顶层 catch 的唯一折算点 */
export function exitCodeForError(error: unknown): number {
  if (error instanceof E2ePreconditionError) {
    return EXIT_PRECONDITION
  }
  if (error instanceof E2eChildFailure) {
    return error.exitCode
  }
  return EXIT_FAILURE
}

/** 统一打印失败（每个入口的 catch 只用这一行；message 之外不打印栈 —— 那是噪音） */
export function reportFailure(prefix: string, error: unknown): number {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[${prefix}] 失败：${message}`)
  return exitCodeForError(error)
}
