import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { runAfterCommit } from '@walnut-server/db'
import { LocaleType } from '@walnut/contract'
import { Recordable } from 'easy-fns-ts'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { SysLangEntity } from '../../lang/entity/lang.entity'
import { SysLangRepoService } from '../../lang/repo/lang.repo.service'
import { SysLocaleEntity } from '../entity/locale.entity'
import { SysLocaleBasicRepository } from '../locale.basic.repository'

/**
 * LocaleType Shared Service
 *
 * Contains complex business logic involving other modules.
 * Used for operations that involve caching, cross-module coordination, etc.
 */
@Injectable()
export class SysLocaleSharedService {
  private readonly logger = new Logger(SysLocaleSharedService.name)

  constructor(
    private readonly localeBasicRepo: SysLocaleBasicRepository,
    private readonly langRepoService: SysLangRepoService,
    private readonly cacheService: AppTechCacheService,
  ) {}

  private getCacheKeys(lang: LocaleType) {
    return `${WalnutAdminConstAppCacheKeys.SYS_LOCALE_MESSAGES}:${lang.replace('-', '_').toLocaleUpperCase()}`
  }

  /**
   * P2-17（2026-10-29）：lang 代号变更时清掉旧代号的 `SYS_LOCALE_MESSAGES` 键。
   *
   * `extractLocaleMessagesIntoCacheForCronJob` 只会写「当前存在的 lang 代号」，
   * 被改掉的旧代号不会出现在 `findAll()` 里 —— 不显式删就会留下永不更新的旧消息缓存。
   */
  async invalidateLocaleMessagesCache(lang: LocaleType) {
    await this.cacheService.del(this.getCacheKeys(lang))
  }

  /**
   * @description extract lang ids to cache which is used for locale request validate
   *
   * B2 迁移：缓存值从 ObjectId 十六进制串改为 lang 的 uuid（消费方 locale.validate 同步改），
   * 缓存键不变。
   */
  async extractLangIdsIntoCache(langs: SysLangEntity[]) {
    await this.cacheService.set(
      WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST,
      langs.map(i => i.id),
      {
        t: WalnutAdminConstAppCacheType.SYSTEM,
      },
    )
  }

  /**
   * @description used for cache locale messages (cron job entry)
   */
  async extractLocaleMessagesIntoCacheForCronJob() {
    const langs = await this.langRepoService.findAll()

    await this.extractLangIdsIntoCache(langs)

    let localeMsgCountForEachLanguage = 0

    await Promise.all(
      langs.map(async (i) => {
        // entity.lang 列型是 string；DB 值域由 seed / DTO 校验收敛到 contract Locale
        const lang = i.lang as LocaleType

        const data = await this.langRepoService.findMessagesByLang(lang)

        localeMsgCountForEachLanguage = Object.keys(data.data).length

        await this.cacheService.set(this.getCacheKeys(lang), data.data, {
          t: WalnutAdminConstAppCacheType.SYSTEM,
        })
      }),
    )

    return localeMsgCountForEachLanguage
  }

  /**
   * @description: main entry for locales message retrieve
   */
  async getLocaleMessage(lang: LocaleType, needCache: boolean) {
    const cached = await this.cacheService.get<Recordable>(this.getCacheKeys(lang))

    if (needCache && cached !== null) {
      return cached
    }

    const locales = await this.langRepoService.findMessagesByLang(lang)

    await this.cacheService.set(this.getCacheKeys(lang), locales.data, {
      t: WalnutAdminConstAppCacheType.SYSTEM,
    })

    return locales.data
  }

  /**
   * @description: delete locales through key (used by controller and other modules)
   */
  async deleteByKey(key: string, userId: string, em?: EntityManager) {
    const deleted = await this.localeBasicRepo.deleteSoftManyByCondition(
      { key },
      userId,
      em,
    )

    this.triggerCacheRefresh()

    return deleted
  }

  /**
   * @description: batch delete by keys (used by controller and other modules)
   */
  async deleteManyByKey(keys: string[], userId: string, em?: EntityManager) {
    const deleted: SysLocaleEntity[] = []
    for (const key of keys) {
      const deletedItems = await this.localeBasicRepo.deleteSoftManyByCondition({ key }, userId, em)
      deletedItems.map(i => deleted.push(i))
    }

    this.triggerCacheRefresh()

    return deleted
  }

  /**
   * @description trigger cache refresh after transaction commit
   */
  triggerCacheRefresh() {
    void runAfterCommit(async () => {
      await this.extractLocaleMessagesIntoCacheForCronJob()
    })
  }
}
