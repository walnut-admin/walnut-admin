import type { IWalnutAdminDataScopeDescriptor, IWalnutAdminDataScopeRlsSettings } from '@walnut-server/db'
import type {
  IWalnutAdminDataScopeDeptUpdateDecision,
  IWalnutAdminDataScopeEntityConfig,
  IWalnutAdminDataScopePolicy,
  WalnutDataScopeFindWhere,
} from '@walnut-server/repository'
import type { EntityManager, EntityTarget, FindOptionsWhere, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'

import { buildWalnutDataScopeRlsSettings, SysEmployeeEntity } from '@walnut-server/system'
import { DataSource } from 'typeorm'
import {
  applyWalnutDataScopePredicate,
  buildWalnutDataScopeFindWhere,
  getWalnutDataScopeEntityConfig,
  mergeWalnutDataScopeFindWhere,
  resolveWalnutDataScopeDeptUpdate,
} from './data-scope'

/**
 * 数据权限策略端口（`IWalnutAdminDataScopePolicy`）的 app 实现 —— libs 解耦批 5 / 批 7。
 *
 * 基类仓库随 `libs/repository` 下沉后不能 import app 的实体注册表（`WALNUT_DATA_SCOPE_ENTITIES`
 * 里横跨 app / auth / shared / identity 四层实体）。本类只做**纯委托**：注册表查询指向
 * `data-scope.ts` 的清单，其余方法指向 libs/system 的谓词纯函数 / RLS 设置构造器 ——
 * 谓词语义只有一份，注册表也只有一份（app 侧），lib 只依赖端口。
 *
 * 批 7：本文件从 `modules/system/data-scope/` 挪到 `common/repository/`（注册表同层）——
 * 策略实现依赖 app 的注册表，因此不能随 data-scope 模块进 libs/system；绑定由 app 的
 * `data-scope.policy.module.ts`（@Global）承担，方向与解耦前的 `DataScopeModule`
 * 一致：app 实现 → lib 端口。
 *
 * `findOwnerDeptId` 是 create 的行级部门回填取数腿（`sys_employee` 现在在 libs/system），
 * 从基类原样搬来：系统级只读查询，不受行级 scope 影响。`implements` 作编译期守护，
 * 端口方法改名/改签名这里立刻红。
 */
@Injectable()
export class WalnutAdminDataScopePolicyService implements IWalnutAdminDataScopePolicy {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  getEntityConfig(entityTarget: EntityTarget<ObjectLiteral> | undefined): IWalnutAdminDataScopeEntityConfig | undefined {
    return getWalnutDataScopeEntityConfig(entityTarget)
  }

  buildFindWhere<Entity extends ObjectLiteral>(
    config: IWalnutAdminDataScopeEntityConfig,
    descriptor: IWalnutAdminDataScopeDescriptor,
    userId: string,
  ): WalnutDataScopeFindWhere<Entity> {
    return buildWalnutDataScopeFindWhere<Entity>(config, descriptor, userId)
  }

  mergeFindWhere<Entity extends ObjectLiteral>(
    base: FindOptionsWhere<Entity> | FindOptionsWhere<Entity>[] | undefined,
    scope: WalnutDataScopeFindWhere<Entity>,
  ): WalnutDataScopeFindWhere<Entity> {
    return mergeWalnutDataScopeFindWhere(base, scope)
  }

  resolveDeptUpdate(
    config: IWalnutAdminDataScopeEntityConfig,
    descriptor: IWalnutAdminDataScopeDescriptor,
    dto: Record<string, unknown>,
    currentDeptId: unknown,
  ): IWalnutAdminDataScopeDeptUpdateDecision {
    return resolveWalnutDataScopeDeptUpdate(config, descriptor, dto, currentDeptId)
  }

  applyPredicate<T extends ObjectLiteral>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    config: IWalnutAdminDataScopeEntityConfig,
    descriptor: IWalnutAdminDataScopeDescriptor,
    userId: string,
  ): void {
    applyWalnutDataScopePredicate(qb, alias, config, descriptor, userId)
  }

  buildRlsSettings(
    descriptor: IWalnutAdminDataScopeDescriptor | undefined,
    userId: string | undefined,
    options: { systemChannel?: boolean, userDeptId?: string | null } = {},
  ): IWalnutAdminDataScopeRlsSettings {
    return buildWalnutDataScopeRlsSettings(descriptor, userId, options)
  }

  /**
   * 取某账号的职工部门（无职工行 → null）。
   * 原基类 `findOwnerDeptId` 的查询体原样迁入（不额外查库、不改 select 面）。
   */
  async findOwnerDeptId(userId: string, em?: EntityManager): Promise<string | null> {
    // 显式 bypass + 理由（原基类的系统通道直连，随批 5/7 迁移至此）：取创建者
    // sys_employee.dept_id 供 SELF/DEPT 谓词与行级回填使用，属数据权限本体逻辑，
    // 不是业务旁路。本目录在 eslint 数据权限直连规则里是豁免区。
    const employee = await (em ?? this.dataSource.manager).getRepository(SysEmployeeEntity).findOne({
      where: { userId },
      select: { deptId: true },
    })

    return employee?.deptId ?? null
  }
}
