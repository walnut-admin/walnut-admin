import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { DataSource } from 'typeorm'
import { SysRoleEntity } from '../../role/entity/role.entity'
import { SysUserDTO } from '../dto/user.dto'
import { SysUserRoleEntity } from '../entity/user-role.entity'
import { SysUserEntity } from '../entity/user.entity'

/**
 * user 行 + Mongo 版 populate virtual 的读出形态（roles_list 为 PG sys_role
 * 行数组；roles_count 与之同步组装 —— 对照 Mongo 版 `user.populate(ROLES_LIST)`
 * + virtual 注入）
 */
export interface ISysUserPopulated extends SysUserEntity {
  roles_list: SysRoleEntity[]
  roles_count: number
}

/**
 * B7a 迁移：Mongo model → PG 命名连接 DataSource。
 *
 * - 跨模块消费的仓库服务直持 DataSource（B2 lang.repo.service / B6 user_device 同款形态）；
 * - 方法面与 Mongo 版一一对齐，事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`
 *   （缺省连接级 manager）；auth 系消费方在 B7c 归一前传 `ctx.em`；
 * - `new Types.ObjectId(userId)` 包装全部摘除（phase3-plan §4 B7 项）：uuid 直传；
 * - roles_list：Mongo 版 populate virtual → sys_user_role junction JOIN
 *   （phase2 4.1；Mongo 版读出的是 sys_role 文档数组，PG 侧为 sys_role 行数组，字段同名）。
 */
@Injectable()
export class SysUserRepositoryService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) { }

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  /**
   * @description find all users
   */
  async findAllUsers(em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserEntity).find()
  }

  /**
   * @description find user by user id
   */
  async findUserByUserId(userId: string, em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserEntity).findOne({ where: { id: userId } })
  }

  /**
   * @description find user by user name
   */
  async findUserByUserName(userName: string, em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserEntity).findOne({ where: { userName } })
  }

  /**
   * @description find user by id and update（returnDocument: 'after' 语义：返回更新后行）
   */
  async findUserByIdAndUpdate(id: string, update: Partial<SysUserEntity>, em?: EntityManager) {
    const repository = this.getManager(em).getRepository(SysUserEntity)

    const target = await repository.findOne({ where: { id } })
    if (!target) {
      return null
    }

    Object.entries(update).forEach(([k, v]) => {
      if (k !== 'id') {
        (target as unknown as Record<string, unknown>)[k] = v
      }
    })

    return repository.save(target)
  }

  /**
   * @description check user existence by payload, return user if existed, otherwise return null
   */
  async checkUserExistence(payload: Partial<SysUserDTO>, em?: EntityManager) {
    return this.getManager(em).getRepository(SysUserEntity).findOne({ where: payload as never })
  }

  /**
   * @description create a new user（主行 + roles junction 同一事务写入，对齐 Mongo 版
   * create 的数组默认值语义；形参 em 已是事务内句柄时直接复用，缺省才自起事务 ——
   * 分支形态对照 Mongo 版 `if (dbSession)`）
   */
  async createUser(payload: Partial<SysUserEntity> & { roles?: string[] }, em?: EntityManager) {
    const run = async (manager: EntityManager) => {
      const repository = manager.getRepository(SysUserEntity)
      const { roles, ...userData } = payload

      const created = await repository.save(repository.create(userData))

      const finalRoles = roles ?? []
      const junction = manager.getRepository(SysUserRoleEntity)
      await junction.delete({ userId: created.id })
      if (finalRoles.length > 0) {
        await junction.insert(finalRoles.map(roleId => ({ userId: created.id, roleId })))
      }

      return Object.assign(created, { roles: finalRoles })
    }

    return em ? run(em) : this.dataSource.transaction(run)
  }

  /**
   * @description 某 user 的角色行（Mongo 版 populate virtual 的 junction 读腿）。
   * 对照 Mongo 版 populate 无 match —— 不筛 role.status，状态判定在业务层
   * （user.shared.checkUserAndRoleStatus）。
   */
  async populatedRolesList(userId: string, em?: EntityManager): Promise<SysRoleEntity[]> {
    return this.getManager(em)
      .createQueryBuilder(SysRoleEntity, 'role')
      .innerJoin(SysUserRoleEntity, 'user_role', 'user_role.roleId = role.id')
      .where('user_role.userId = :userId', { userId })
      .getMany()
  }

  /**
   * @description 给 user 行组装 roles_list / roles_count
   * （对照 Mongo 版 `user.populate({ path: ROLES_LIST })` 的读出形态）
   */
  async attachPopulatedRoles<T extends SysUserEntity>(user: T, em?: EntityManager): Promise<T & ISysUserPopulated> {
    const roles = await this.populatedRolesList(user.id, em)

    return Object.assign(user, {
      roles_list: roles,
      roles_count: roles.length,
    })
  }
}
