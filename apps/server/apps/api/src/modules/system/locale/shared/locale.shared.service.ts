import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { LocaleType } from '@walnut/contract'
import { runAfterCommit } from '@walnut-server/db'
import { Recordable } from 'easy-fns-ts'
import { ClientSession } from 'mongoose'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { SysLangRepoService } from '../../lang/repo/lang.repo.service'
import { ISysLangDocument } from '../../lang/schema/lang.schema'
import { SysLocaleBasicRepository } from '../locale.basic.repository'
import { ISysLocaleDocument } from '../schema/locale.schema'

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
   * @description extract lang ids to cache which is used for locale request validate
   */
  async extractLangIdsIntoCache(langs: ISysLangDocument[]) {
    await this.cacheService.set(
      WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST,
      langs.map(i => i._id),
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
        const data = await this.langRepoService.findMessagesByLang(i.lang)

        localeMsgCountForEachLanguage = Object.keys(data.data).length

        await this.cacheService.set(this.getCacheKeys(i.lang), data.data, {
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
  async deleteByKey(key: string, userId: string, dbSession?: ClientSession) {
    const deleted = await this.localeBasicRepo.deleteSoftManyByCondition(
      { key },
      userId,
      dbSession,
    )

    this.triggerCacheRefresh()

    return deleted
  }

  /**
   * @description: batch delete by keys (used by controller and other modules)
   */
  async deleteManyByKey(keys: string[], userId: string, dbSession?: ClientSession) {
    const deleted: ISysLocaleDocument[] = []
    for (const key of keys) {
      const deletedItems = await this.localeBasicRepo.deleteSoftManyByCondition({ key }, userId, dbSession)
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
