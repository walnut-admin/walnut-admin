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

import { DataSource } from 'typeorm'
import {
  applyWalnutDataScopePredicate,
  buildWalnutDataScopeFindWhere,
  getWalnutDataScopeEntityConfig,
  mergeWalnutDataScopeFindWhere,
  resolveWalnutDataScopeDeptUpdate,
} from '@/common/repository/data-scope'
import { buildWalnutDataScopeRlsSettings } from '@/common/repository/data-scope.rls'
import { SysEmployeeEntity } from '../employee/entity/employee.entity'

/**
 * 数据权限策略端口（`IWalnutAdminDataScopePolicy`）的 app 实现 —— libs 解耦批 5。
 *
 * 基类仓库随 `libs/repository` 下沉后不能 import app 的实体注册表（`WALNUT_DATA_SCOPE_ENTITIES`
 * 里全是 app 实体）。本类只做**纯委托**：注册表查询指向 `data-scope.ts` 的清单，其余
 * 方法指向同文件的纯函数 / `data-scope.rls.ts` 的 RLS 设置构造器 —— 谓词语义与清单
 * 仍只有一份（app 侧），lib 只依赖端口。
 *
 * `findOwnerDeptId` 是 create 的行级部门回填取数腿（`sys_employee` 是 app 实体），
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
    // eslint-disable-next-line no-restricted-syntax -- 系统级只读回填腿（原基类 common/repository 的豁免同款）：create 必须看到创建者此刻的真实部门，不受行级 scope 影响；经 BasicRepository 反而会触发 scope fail-closed
    const employee = await (em ?? this.dataSource.manager).getRepository(SysEmployeeEntity).findOne({
      where: { userId },
      select: { deptId: true },
    })

    return employee?.deptId ?? null
  }
}
