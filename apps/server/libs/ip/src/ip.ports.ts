import type { EntityManager } from 'typeorm'

/**
 * 永久 IP 黑名单存储端口（libs 解耦批 5 的依赖反转）。
 *
 * 永久黑名单存在 app_setting（`app.global.ipBlacklist`），读写此前直连 app 的
 * `AppSettingRepositoryService`（lib → app 反向依赖）。端口只暴露 ip 服务实际用到的
 * 两个方法；实现随 setting 域落在 `libs/app-domain`，由该 lib 的
 * `AppSettingsRepositoryModule`（@Global）用
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

/**
 * 操作日志拦截器的 IP 定位端口（Decision 3「token 放**需要它**的 lib」）。
 *
 * 消费者是 libs/crud 的 operate-log 拦截器（只认 `getLocationFromBaidu` 一个方法），实现是本
 * lib 的 `SharedIpService` —— token 因此落在 libs/ip。原落点 `crud/operate-log.ports.ts`
 * 让 ip（技术设施）反向引 crud（技术装配内核），即 ARCH-01 那条「设施依赖内核」的纵向边；
 * F-14 拆层后 tech-base 引 tech-assemble 被 eslint 直接拦，token 换位后 **crud → ip**
 * 方向为正（assemble 单向下依赖 base），ip 不再引 crud。
 *
 * 绑定跟着实现走：`SharedIpModule`（@Global）用 useExisting 绑到 SharedIpService，该类
 * `implements IWalnutAdminIpLocationResolver` 作编译期守护（方法改名/改签名立刻红，而不是
 * 等运行期 token 解析出 undefined）。
 */
export const WALNUT_ADMIN_IP_LOCATION_RESOLVER = Symbol('WALNUT_ADMIN_IP_LOCATION_RESOLVER')

export interface IWalnutAdminIpLocationResolver {
  getLocationFromBaidu: (ip: string) => Promise<string | null>
}
