import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { ThrottlerConfigService } from './throttler.service'

/**
 * ThrottlerModule 的薄封装：只负责动态注册（配置来自 ThrottlerConfigService）。
 *
 * **guard 边界**（libs 解耦批 2）：`WalnutAdminGuardThrottler` 是 app 的全局 guard
 * （`apps/api/src/guard/throttler.guard.ts`），其 APP_GUARD 注册留在 app 侧
 * （`AppTechModule`）—— lib 禁止 import app。ThrottlerModule 自身是 @Global 的，
 * 选项与 storage 对 app 侧注册的 guard 仍然可见。
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useClass: ThrottlerConfigService,
    }),
  ],
  providers: [],
  exports: [],
})
export class AppTechThrottlerModule {}
