import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { runAfterCommit } from '@walnut-server/db'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import {
  SysLangDTOCreateRequest,
  SysLangDTOListRequest,
  SysLangDTOUpdateRequest,
} from './dto/lang.dto'
import { SysLangBasicRepository } from './lang.basic.repository'
import { SysLangRepoService } from './repo/lang.repo.service'

/**
 * Lang Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service layer.
 */
@Injectable()
export class SysLangService {
  constructor(
    private readonly langBasicRepo: SysLangBasicRepository,
    private readonly langRepoService: SysLangRepoService,
    private readonly cacheService: AppTechCacheService,
  ) {}

  /**
   * P2-5：lang 变更后失效 public 响应缓存（对齐 locale 的 runAfterCommit 全量刷新通道）。
   *
   * public 端点经 `@WalnutAdminDecoratorCache` 缓存 `SYS_LANG_LIST_PUBLIC`（1h TTL），
   * 失效必须挂在事务提交后 —— 事务回滚时缓存保持原值，提交后下次 public 请求回源
   * 重建缓存，立见新值。
   */
  private async triggerPublicListCacheRefresh() {
    // 无事务上下文的 CRUD 路径由 runAfterCommit 内联执行（await 保证响应返回前已失效；
    // 未来若挂 @WalnutTx，钩子自动推迟到提交后由事务拦截器统一执行）
    await runAfterCommit(async () => {
      await this.cacheService.del(WalnutAdminConstAppCacheKeys.SYS_LANG_LIST_PUBLIC)
    })
  }

  /**
   * @description create lang (controller: create)
   */
  async create(dto: SysLangDTOCreateRequest) {
    const created = await this.langBasicRepo.create(dto)
    await this.triggerPublicListCacheRefresh()
    return created
  }

  /**
   * @description read lang by id (controller: read)
   */
  async read(id: string) {
    return this.langRepoService.findByIdWithLocaleCounts(id)
  }

  /**
   * @description update lang (controller: update)
   */
  async update(id: string, dto: SysLangDTOUpdateRequest) {
    const updated = await this.langBasicRepo.update(id, dto)
    await this.triggerPublicListCacheRefresh()
    return updated
  }

  /**
   * @description list langs (controller: list)
   *
   * Mongo 版的 locale 计数 / process 管道随 B2 迁入 lang.basic.repository 的 PG list 覆写
   */
  async list(payload: SysLangDTOListRequest) {
    return this.langBasicRepo.list(payload)
  }

  /**
   * @description public language list, no auth (controller: listPublic)
   */
  async listPublic() {
    return this.langRepoService.findPublic()
  }
}
