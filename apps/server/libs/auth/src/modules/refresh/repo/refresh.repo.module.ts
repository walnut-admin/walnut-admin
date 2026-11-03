import { Module } from '@nestjs/common'
import { AuthRefreshRepositoryService } from './refresh.repo.service'

/**
 * B7b 迁移：Mongo forFeature 摘除（实体注册在 AuthRefreshModule 的 PG forFeature 里）。
 *
 * D10（批次 5）：**不再 @Global** —— 注入 `AuthRefreshRepositoryService` 的类只有
 * `AuthRefreshSharedService`（声明在 `AuthRefreshSharedModule`），判据「消费方模块 ≥ 2」
 * 不成立，该模块现已显式 import 本模块。
 *
 * 旧注释写「auth shared / signout / monitor / task 消费方经它注入」是错的：那说的是
 * **shared** service（`AuthRefreshSharedService`），不是这个仓库。把两者混成一句正是
 * 「三种 Repository 模式」口径留下的债。
 */
@Module({
  imports: [],
  controllers: [],
  providers: [AuthRefreshRepositoryService],
  exports: [AuthRefreshRepositoryService],
})
export class AuthRefreshRepositoryModule { }
