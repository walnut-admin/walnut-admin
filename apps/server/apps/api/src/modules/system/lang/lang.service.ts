import type { LocaleType } from '@walnut/contract'
import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { runAfterCommit } from '@walnut-server/db'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { SysLocaleSharedService } from '../locale/shared/locale.shared.service'
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
    private readonly localeSharedService: SysLocaleSharedService,
    private readonly cacheService: AppTechCacheService,
  ) {}

  /**
   * P2-5 / P2-17：lang 变更后失效 public 响应缓存，并与 locale 的刷新通道对齐。
   *
   * - `SYS_LANG_LIST_PUBLIC`：public 端点经 `@WalnutAdminDecoratorCache` 缓存（1h TTL）；
   * - `SYS_LANG_ID_LIST` + `SYS_LOCALE_MESSAGES`：`SYS_LANG_ID_LIST` 是 locale 入参的
   *   白名单，只有 locale 侧的全量刷新会写它 —— 新建语言后不刷新的话，紧接着给新
   *   langId 写翻译会被旧白名单挡成 `Invalid of langId`（40099）。直接复用同一全量
   *   刷新入口，两个缓存键与语言代号集合一起重算。
   *
   * 失效必须挂在事务提交后 —— 事务回滚时缓存保持原值，提交后下次读取回源重建。
   * 无事务上下文的 CRUD 路径由 runAfterCommit 内联执行（await 保证响应返回前已完成）。
   */
  private async triggerCacheRefresh(oldLang?: string) {
    await runAfterCommit(async () => {
      await this.cacheService.del(WalnutAdminConstAppCacheKeys.SYS_LANG_LIST_PUBLIC)

      // lang 代号被改掉时，旧代号的 SYS_LOCALE_MESSAGES 键不会被 findAll 覆盖到 —— 显式清
      if (oldLang !== undefined) {
        await this.localeSharedService.invalidateLocaleMessagesCache(oldLang as LocaleType)
      }

      await this.localeSharedService.extractLocaleMessagesIntoCacheForCronJob()
    })
  }

  /**
   * @description create lang (controller: create)
   */
  async create(dto: SysLangDTOCreateRequest) {
    const created = await this.langBasicRepo.create(dto)
    await this.triggerCacheRefresh()
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
    // 先读旧行：lang 代号可改，旧代号的 SYS_LOCALE_MESSAGES 缓存需要显式失效
    const current = await this.langBasicRepo.readById(id)
    const updated = await this.langBasicRepo.update(id, dto)
    await this.triggerCacheRefresh(
      current.lang !== updated.lang ? current.lang : undefined,
    )
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
