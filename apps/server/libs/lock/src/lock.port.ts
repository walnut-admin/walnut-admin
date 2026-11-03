/**
 * 分布式锁端口（D11 / 批次 5：把 murlock 收进 libs/lock 的唯一入口）。
 *
 * 背景：改造前有 **两套并存** 的锁实现 ——
 * - 自研 `AppTechCacheCronLockService`（libs/cache/service/cache.cron-lock.ts）：Redis
 *   `SET NX EX` 非阻塞 try-lock，专供 `@Cron` 单实例（语义见 ADR 0025）；
 * - 三方 `murlock`（blocking + 重试）：10 处业务代码直接
 *   `import { MurLockService } from 'murlock'`，绕过 `libs/lock`，换实现要改 10 个文件。
 *
 * 本端口只覆盖**第二条**（阻塞式互斥的临界区），cron 单实例锁**不并入**：
 * 两者语义不同 —— cron 要的是「拿不到就跳过这次 tick、Redis 故障时 fail-open 照跑」，
 * 而本端口要的是「排队等待直到拿到锁」。把 cron 塞进这里会把 fail-open 的三条路径
 * （命令异常 / 抢锁超时 / 键被占）压成一条，破坏 ADR 0025 的兜底口径。
 *
 * 用法（消费方只认 token 与接口，不认 vendor）：
 *
 *     constructor(
 *       @Inject(WALNUT_ADMIN_LOCK) private readonly lockService: WalnutLockService,
 *     ) {}
 *     await this.lockService.runWithLock(lockKey, 3000, fn)
 *
 * 该 token 由 `AppTechLockModule`（@Global）绑定到 `MurLockAdapter`，
 * 真实实现在 `murlock.adapter.ts` —— **`from 'murlock'` 只允许出现在 libs/lock 内部**，
 * 由 `murlock-isolation.drift.spec.ts` 机械守（新代码再直连会让单测红）。
 */
export const WALNUT_ADMIN_LOCK = Symbol('WALNUT_ADMIN_LOCK')

/**
 * 锁端口接口（服务形状，注入点读作 `lockService: WalnutLockService`）。
 *
 * 与既有 `IWalnutAdmin*` 端口命名不一致是**有意**的：那些端口是数据形状
 * （仓储 / 策略 / TTL 读写），这个端口是「执行器」——调用方给一段临界区，它负责
 * 加锁、等待、失败传播。名字照 D11 决策原文取 `WalnutLockService`。
 */
export interface WalnutLockService {
  /**
   * 在分布式锁内执行 `fn`（阻塞：拿不到锁时按实现自己的重试策略等待）。
   *
   * @param lockKey 锁键。命名空间前缀由调用方拼（现存 10 处统一用
   *   `WalnutAdminConstAppCacheKeys.APP_MURLOCK`，形如 `APP:MURLOCK:CAP:<deviceId>`）。
   * @param releaseTimeMs 锁的自动释放时间（毫秒）——持锁进程崩溃时的兜底 TTL，
   *   必须大于临界区的最长耗时。
   * @param fn 临界区。抛错会原样传给调用方，且实现负责释放锁。
   * @returns `fn` 的返回值。
   */
  runWithLock: <T>(lockKey: string, releaseTimeMs: number, fn: () => Promise<T>) => Promise<T>
}
