import type { WalnutLockService } from './lock.port'
import { Injectable } from '@nestjs/common'
import { MurLockService } from 'murlock'

/**
 * `WalnutLockService` 的 murlock 适配器（D11）。
 *
 * 纯委托，**零额外语义**：murlock 的 3 参重载已经在模块配置里钉死
 * （`blocking: true` / `wait: 100` / `maxAttempts: 50` / `failFastOnRedisError: false`，
 * 见 lock.module.ts），所以适配器不能也不该再引入重试或超时口径 —— 换实现时
 * 需要满足的是端口注释里的那条契约，而不是这里的历史行为。
 *
 * 这个文件是**全仓唯一**允许 `from 'murlock'` 的地方（外加 lock.module.ts 的
 * `MurLockModule`）；被 `murlock-isolation.drift.spec.ts` 机械守。
 */
@Injectable()
export class MurLockAdapter implements WalnutLockService {
  constructor(private readonly murLockService: MurLockService) {}

  async runWithLock<T>(lockKey: string, releaseTimeMs: number, fn: () => Promise<T>): Promise<T> {
    return this.murLockService.runWithLock(lockKey, releaseTimeMs, fn)
  }
}
