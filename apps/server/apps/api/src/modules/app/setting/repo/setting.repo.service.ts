import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { runAfterCommit, WalnutPGConnectionName } from '@walnut-server/db'
import { DataSource } from 'typeorm'

import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'
import { AppSettingEntity } from '../entity/setting.entity'

/**
 * B4 迁移：数据源从 Mongo model 换成 PG 命名连接的 DataSource（B2 lang.repo.service
 * 同款形态 —— 跨模块消费的仓库服务直持 DataSource）。三个方法的语义逐一对齐 Mongo 版：
 *
 * - extractAppSettingIntoCache：全表拉取（app_setting 是配置小表，数十行，顺序扫描
 *   即正确路径），组装 { settingKey → settingValue } 后整体写缓存 —— 缓存 key
 *   （APP_SETTING）与刷新触发点不动，只换数据源。
 * - findAppSettingByKey：uq_setting_key 唯一索引点查；value 仍 JSON.parse（Q4 定案
 *   setting_value 保持 text，内嵌 id 订正在 B5/B7 ETL 专项）。
 * - updateAppSettingByKey： findOne + save（撞 uq_setting_key 语义同 Mongo 版
 *   findOneAndUpdate：查无此 key 时静默无操作，不抛 NotFound）；缓存刷新经
 *   runAfterCommit —— 事务内调用则推迟到提交后（PG commit 后触发，链路不断），
 *   事务外调用就地执行。
 */
@Injectable()
export class AppSettingRepositoryService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,

    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
  ) {}

  private getManager(em?: EntityManager): EntityManager {
    return em ?? this.dataSource.manager
  }

  // extract all app setting into cache
  async extractAppSettingIntoCache() {
    const allAppSettings = await this.getManager().getRepository(AppSettingEntity).find()

    const dataToCache = Object.fromEntries(
      allAppSettings.map(i => [i.settingKey, i.settingValue]),
    )

    await this.cacheAppSettingsService.setAppSettings(dataToCache, {
      t: WalnutAdminConstAppCacheType.BUILT_IN,
    })

    return allAppSettings.length
  }

  /**
   * @description find app setting by key
   */
  async findAppSettingByKey<T>(key: string, em?: EntityManager): Promise<T | null> {
    const doc = await this.getManager(em).getRepository(AppSettingEntity).findOne({ where: { settingKey: key } })
    return doc && Reflect.has(doc, 'settingValue') ? JSON.parse(doc.settingValue) as T : null
  }

  /**
   * @description update app setting by key
   */
  async updateAppSettingByKey(key: string, value: string, em?: EntityManager) {
    const repository = this.getManager(em).getRepository(AppSettingEntity)
    const doc = await repository.findOne({ where: { settingKey: key } })

    if (doc) {
      doc.settingValue = value
      await repository.save(doc)
    }

    // extract app setting into cache after transaction commit
    await runAfterCommit(async () => {
      await this.extractAppSettingIntoCache()
    })
  }
}
