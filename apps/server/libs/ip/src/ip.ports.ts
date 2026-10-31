import type { EntityManager } from 'typeorm'

/**
 * 永久 IP 黑名单存储端口（libs 解耦批 5 的依赖反转）。
 *
 * 永久黑名单存在 app_setting（`app.global.ipBlacklist`），读写此前直连 app 的
 * `AppSettingRepositoryService`（lib → app 反向依赖）。端口只暴露 ip 服务实际用到的
 * 两个方法；实现由 app 在 `AppSettingsRepositoryModule`（@Global）用
 * `{ provide: WALNUT_ADMIN_BLACKLIST_REPOSITORY, useExisting: AppSettingRepositoryService }`
 * 绑定，`AppSettingRepositoryService implements IWalnutAdminBlacklistRepository`
 * 作编译期守护。
 *
 * 临时黑名单（Redis）不经本端口 —— 已由 `@walnut-server/cache` 提供。
 */
export const WALNUT_ADMIN_BLACKLIST_REPOSITORY = Symbol('WALNUT_ADMIN_BLACKLIST_REPOSITORY')

export interface IWalnutAdminBlacklistRepository {
  findAppSettingByKey: <T>(key: string, em?: EntityManager) => Promise<T | null>
  updateAppSettingByKey: (key: string, value: string, em?: EntityManager) => Promise<void>
}
