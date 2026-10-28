import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { runAfterCommit } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { Role } from '@walnut/contract'
import { AppTechCachePermissionsService } from '@/modules/techniques/cache/service/cache.permissions'

import {
  SysRoleDTOCreateRequest,
  SysRoleDTOListRequest,
  SysRoleDTOUpdateRequest,
} from './dto/role.dto'
import { SysRoleRepoService } from './repo/role.repo.service'
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

    const permissionsAffected = dto.menus !== undefined
      || (dto.status !== undefined && role !== null && dto.status !== role.status)
    const affectedUserIds = permissionsAffected
      ? await this.roleRepoService.findUserIdsByRoleId(id, em)
      : []

    const updated = await this.roleBasicRepo.update(id, dto, em)

    if (affectedUserIds.length > 0) {
      await runAfterCommit(async () => {
        for (const userId of affectedUserIds) {
          await this.cachePermissionsService.delPermissionsForUser(userId)
        }
        this.logger.debug(`role ${id} change invalidated permission cache for ${affectedUserIds.length} user(s)`)
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
}
