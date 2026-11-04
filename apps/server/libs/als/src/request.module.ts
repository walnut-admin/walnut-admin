import { Global, Module } from '@nestjs/common'
import { LoggerContextService } from './logger-context.service'
import { ALSRequestService } from './request.service'

/**
 * libs/als 唯一对外的 `@Global` 模块（D13②：`libs/context` 并进来后两套 ALS 共用它）。
 *
 * 为什么同一模块里放两个 service：两者是**同一类基础设施**（`node:async_hooks` 的
 * `AsyncLocalStorage`），消费面也都是横切 —— 分开装会让每个组合根都要记两条接线。
 * store 形状与实例仍然分开，判据写在 `logger-context.als.ts` 顶部。
 *
 * 模块名沿用 `AppALSRequestModule`（改动前就叫这个）：改名要动 `shared.module.ts` 的接线，
 * 而能力边界由 providers 决定、不由类名 —— 本批不为命名付扩散成本。
 */
@Global()
@Module({
  providers: [ALSRequestService, LoggerContextService],
  exports: [ALSRequestService, LoggerContextService],
})
export class AppALSRequestModule {}
