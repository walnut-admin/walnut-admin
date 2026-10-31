import type { Provider } from '@nestjs/common'
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'

/**
 * 回收站快照恢复器（libs 解耦批 7）。
 *
 * 背景：`sys_deleted` 的恢复路由原先是 `system/deleted/repo/recover-registry.ts` 里的
 * 一份**全域静态清单** —— 它在 libs/system 内硬 import 了 app / auth / shared 的实体，
 * 把「回收站」这一个域与其它所有域钉死。批 7 改为登记制：本文件只定义
 * `WalnutAdminRecoverableRegistry` 与通用恢复器工厂（不 import 任何实体），各域在自己
 * 的 Nest module 里把「实体 → 恢复器」登记进来；deleted 的 service 只消费注册表。
 *
 * 为什么放在 libs/repository（而不是 libs/system）：实体在哪个 lib/域就由哪个域注册 ——
 * user / user_identity 等实体在 libs/identity，它不能反向 import libs/system，只能依赖
 * 更低层。回收站快照表 `SysDeletedEntity` 也随之下沉到这里（软删策略端口
 * `ISoftDeleteStrategy` 的同层数据面），identity 的 user 组合恢复器因此无需触达
 * libs/system。
 */

export interface IWalnutAdminRecoverableRecoverer {
  /**
   * 把快照对象还原回原表（insert 一行）。实现约束：
   * - 快照引用列已是 uuid（v5 派生规则），无需重写；
   * - 必须接收事务内 `em`（recover 的「原表 insert + sys_deleted delete」两步写
   *   要在同一本地事务内）。
   */
  recover: (content: Record<string, unknown>, em: EntityManager) => Promise<unknown>
}

/** 登记项：modelName（`WalnutModelName`，软删快照的路由键）→ 目标实体 + 恢复器 */
export interface IWalnutAdminRecoverableEntry<T extends ObjectLiteral = ObjectLiteral> {
  modelName: string
  entityTarget: EntityTarget<T>
  recoverer: IWalnutAdminRecoverableRecoverer
}

/**
 * 通用快照恢复器工厂：`entityTarget` 即注册。快照 content 是 jsonb 直存对象
 * （B0 起新形态，无 Mongo 时代 stringify 的 ObjectId 还原包袱），恢复语义就是
 * 「按目标实体把快照行原样插回」—— 含原 uuid 主键与 created_at / updated_at 时间戳列
 * （insert() 对显式赋值的列原样落库，仅 undefined 才走列默认值，故 uuidv7 /
 * gen_random_uuid 与 CreateDate/UpdateDate 的默认值通道都不会被触发）。
 * 引用完整性（FK / 唯一约束）由数据库在插入时把关，违反即抛错走受控恢复失败。
 */
export function createWalnutAdminSnapshotRecoverer<T extends ObjectLiteral>(
  entityTarget: EntityTarget<T>,
): IWalnutAdminRecoverableRecoverer {
  return {
    recover: async (content: Record<string, unknown>, em: EntityManager) => {
      await em.getRepository(entityTarget).insert(content as never)
    },
  }
}

/**
 * 恢复器登记表（run-time registration）。
 *
 * 每个域在自己的 Nest module 装配期调用 `register`（薄 factory provider），
 * `SysDeletedService` 只按 modelName 路由。同名重复注册是装配错误，直接抛错而非
 * 静默覆盖 —— 两个域抢同一个 modelName 时启动期即红。
 */
@Injectable()
export class WalnutAdminRecoverableRegistry {
  private readonly logger = new Logger(WalnutAdminRecoverableRegistry.name)

  private readonly entries = new Map<string, IWalnutAdminRecoverableEntry>()

  /**
   * @description 模块装配期登记恢复器；同名重复注册是装配错误
   */
  register(entry: IWalnutAdminRecoverableEntry): void {
    if (this.entries.has(entry.modelName)) {
      throw new Error(`[WalnutAdminRecoverableRegistry] recoverer for "${entry.modelName}" is already registered`)
    }
    this.entries.set(entry.modelName, entry)
    this.logger.log(`recoverer registered: ${entry.modelName}`)
  }

  get(modelName: string): IWalnutAdminRecoverableRecoverer | undefined {
    return this.entries.get(modelName)?.recoverer
  }

  getEntry(modelName: string): IWalnutAdminRecoverableEntry | undefined {
    return this.entries.get(modelName)
  }

  has(modelName: string): boolean {
    return this.entries.has(modelName)
  }

  /** 登记快照（modelName → entityTarget → recoverer）；drift spec 按它做运行期对账 */
  getAll(): ReadonlyArray<IWalnutAdminRecoverableEntry> {
    return [...this.entries.values()]
  }
}

/**
 * 各域 Nest module 用的薄 factory provider：装配期把该域的登记函数跑一遍。
 *
 * 每次调用生成独立的 Symbol token（同一模块里挂多个域也不会撞 key），
 * `useFactory` 返回 `true` —— 登记本身是副作用，provider 值不参与运行。
 */
export function createWalnutAdminRecoverableRegistrar(
  register: (registry: WalnutAdminRecoverableRegistry) => void,
): Provider {
  return {
    provide: Symbol('WALNUT_ADMIN_RECOVERABLE_REGISTRAR'),
    useFactory: (registry: WalnutAdminRecoverableRegistry) => {
      register(registry)
      return true
    },
    inject: [WalnutAdminRecoverableRegistry],
  }
}
