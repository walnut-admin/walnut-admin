import type { EntityManager } from 'typeorm'
import type { IRoleAuthorizationAuditSnapshot } from './role.audit'
import { Injectable, Logger } from '@nestjs/common'
import { ALSRequestService } from '@walnut-server/als'
import { WalnutAdminConstDataScope } from '@walnut-server/const/app/dataScope'
import { runAfterCommit } from '@walnut-server/db'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { Role } from '@walnut/contract'
import { AppTechCachePermissionsService } from '@/modules/techniques/cache/service/cache.permissions'
import { DataScopeService } from '../data-scope/data-scope.service'
import {
  SysRoleDTOCreateRequest,
  SysRoleDTOListRequest,
  SysRoleDTOUpdateRequest,
} from './dto/role.dto'
import { SysRoleRepoService } from './repo/role.repo.service'
import { buildRoleAuthorizationAuditAfter, buildRoleAuthorizationAuditSnapshot } from './role.audit'
import { SysRoleBasicRepository } from './role.basic.repository'

/**
 * Role Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service layer.
 */
@Injectable()
export class SysRoleService {
  private readonly logger = new Logger(SysRoleService.name)

  constructor(
    private readonly roleBasicRepo: SysRoleBasicRepository,
    private readonly roleRepoService: SysRoleRepoService,
    private readonly cachePermissionsService: AppTechCachePermissionsService,
    private readonly dataScopeService: DataScopeService,
    private readonly alsRequestService: ALSRequestService,
  ) {}

  /**
   * @description create role (controller: create)
   */
  async create(dto: SysRoleDTOCreateRequest, em?: EntityManager) {
    // cannot create root/developer role
    if (dto.roleName === Role.ROOT || dto.roleName === Role.DEVELOPER) {
      throw new WalnutAdminExceptionBadRequest()
    }
    return this.roleBasicRepo.create(dto, em)
  }

  /**
   * @description read role by id (controller: read)
   *
   * B5：usersCount 由 sys_user_role 计数子查询承接（Mongo 版 count virtual），
   * menus 由 junction 读出（uuid 数组）。
   */
  async read(id: string) {
    return this.roleRepoService.findByIdWithUsersCount(id)
  }

  /**
   * @description update role (controller: update)
   *
   * P2-16（2026-10-28）：授权整组替换（menus）或启停（status）会改变该角色下用户的
   * 权限串 —— 写腿成功后按 `sys_user_role` 反查受影响 userId，事务提交后逐个失效
   * `AUTH:PERMISSIONS:<user>:*`（permission.guard 只读缓存，取消权限必须走服务端通道）。
   */
  async update(id: string, dto: SysRoleDTOUpdateRequest, em?: EntityManager) {
    // cannot update root role
    if (dto.roleName === Role.ROOT) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // Mongo 版按「id === 根角色 ObjectId hex」拦根角色更新；PG 侧根角色 id 是该 hex 的
    // v5 派生 uuid（ETL 通道生成，工具链在 @walnut/scripts uuid5.ts，phase2 §3.3），
    // 服务端不做派生，改用等价判据：root 角色名全库唯一（create 已拦 'root'），命中即根角色。
    // 查无此 id 时不在这里拦 —— 交给 repo.update 抛 DataNotFound（对齐 Mongo 路径）。
    const role = await this.roleRepoService.findById(id, em)
    if (role?.roleName === Role.ROOT) {
      throw new WalnutAdminExceptionBadRequest()
    }

    // 批 7 / L7（P3-35 收口）：授权敏感面的 before 快照。角色行（dataScope/status）由
    // 基类 update 写进 ALS 快照，menus/deptIds 在 junction —— 必须在写腿之前读出，
    // 否则拿到的是替换后的清单。查无此 id 时不读 junction，交给 repo.update 抛
    // DataNotFound（对齐既有路径）。
    const authorizationBefore = role === null
      ? null
      : buildRoleAuthorizationAuditSnapshot(
          role,
          await this.roleRepoService.findDeptIdsByRoleId(id, em),
          await this.roleRepoService.findMenuIdsByRoleId(id, em),
        )

    const permissionsAffected = dto.menus !== undefined
      || (dto.status !== undefined && role !== null && dto.status !== role.status)

    // 数据权限：dataScope 或 status（停用角色不参与 scope 解析）变化都会
    // 改变成员的行级可见面 —— 与权限缓存同一反查腿失效 `AUTH:DATA_SCOPE:<userId>`。
    //
    // 二期批 2：`sys_role_dept`（CUSTOM 部门清单）整组替换同样是数据权限输入 ——
    // 只在「当前是 CUSTOM」或「本次改成 CUSTOM」时影响执行语义；清单变更也只影响该角色
    // 成员的描述符（成员反查腿同 dataScope 失效）。
    const dataScopeAffected = (dto.dataScope !== undefined && role !== null && dto.dataScope !== role.dataScope)
      || (dto.status !== undefined && role !== null && dto.status !== role.status)

    const deptScopeAffected = dto.deptIds !== undefined && (
      role?.dataScope === WalnutAdminConstDataScope.CUSTOM
      || dto.dataScope === WalnutAdminConstDataScope.CUSTOM
    )

    const affectedUserIds = permissionsAffected || dataScopeAffected || deptScopeAffected
      ? await this.roleRepoService.findUserIdsByRoleId(id, em)
      : []

    const updated = await this.roleBasicRepo.update(id, dto, em)

    // 批 7 / L7（P3-35 收口）：把 menus/deptIds 并入操作日志的 ALS 快照（行快照由
    // 基类写入，这里合并而不覆盖）。四个授权敏感面 dataScope/status/deptIds/menus
    // 因此在 sys_log_operate 的 snapshot diff 里可见 before → after。
    if (authorizationBefore !== null) {
      this.attachAuthorizationAuditSnapshot(
        authorizationBefore,
        buildRoleAuthorizationAuditAfter(updated, authorizationBefore, dto),
      )
    }

    if (affectedUserIds.length > 0) {
      await runAfterCommit(async () => {
        if (permissionsAffected) {
          for (const userId of affectedUserIds) {
            await this.cachePermissionsService.delPermissionsForUser(userId)
          }
        }

        if (dataScopeAffected || deptScopeAffected) {
          await this.dataScopeService.invalidateForUsers(affectedUserIds)
        }

        this.logger.debug(
          `role ${id} change invalidated permission cache (${permissionsAffected ? 'on' : 'off'}) / data scope (${dataScopeAffected || deptScopeAffected ? 'on' : 'off'}) for ${affectedUserIds.length} user(s)`,
        )
      })
    }

    return updated
  }

  /**
   * @description list roles (controller: list)
   *
   * B5：usersCount 改 junction 计数子查询（role.basic.repository list 覆写，
   * 对齐 Mongo 版 $lookup + $size 出参字段）。
   */
  async list(params: SysRoleDTOListRequest) {
    return this.roleBasicRepo.list(params)
  }

  /**
   * 把授权敏感面并入操作日志的 ALS 快照（`WalnutAdminInterceptorRequestOperateLog`
   * 读取后落 `sys_log_operate.snapshot_before / snapshot_after`）。
   *
   * 基类 `WalnutAdminCommonPgBaseRepository.update` 已写入整行快照；这里**合并**而不是
   * 覆盖，保留行字段的既有审计面，只补 junction 两腿。无 ALS 上下文（直接调用 service
   * 的测试 / 内部任务）直接跳过，不制造噪声告警。
   */
  private attachAuthorizationAuditSnapshot(
    before: IRoleAuthorizationAuditSnapshot,
    after: IRoleAuthorizationAuditSnapshot,
  ) {
    if (!this.alsRequestService.hasActiveContext()) {
      return
    }

    const merge = (key: 'snapshotBefore' | 'snapshotAfter', audit: IRoleAuthorizationAuditSnapshot) => {
      const existing = this.alsRequestService.get(key) ?? {}
      this.alsRequestService.set(key, Object.assign({}, existing, audit))
    }

    merge('snapshotBefore', before)
    merge('snapshotAfter', after)
  }
}
