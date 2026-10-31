/* eslint-disable no-restricted-syntax -- 登录/鉴权系统通道：本服务是 user 的「系统读腿」（AT payload 组装、junction 实时 membership、角色切换校验、恢复），必须在无 ALS 上下文的 guard 链里直连库；行级数据权限只覆盖 HTTP 处理器内的基类仓库，见 common/repository/data-scope.ts 豁免清单。 */
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName, withWalnutSystemManager } from '@walnut-server/db'
import { DataSource, In } from 'typeorm'
import { SysRoleEntity } from '../../shared/sys-role.entity'
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

  /**
   * 数据权限三期：sys_user 已注册 RLS（缺省 anonymous）。系统读腿在无 em 时必须
   * 开一条 system 事务（登录链 / guard / 缓存失效反查都不在请求事务里）；带 em
   * 的调用沿用调用方事务（会计入当前用户天花板）。
   */
  private async withSystemManager<T>(em: EntityManager | undefined, fn: (manager: EntityManager) => Promise<T>) {
    return withWalnutSystemManager(this.dataSource, em, fn)
  }

  /**
   * @description find all users
   */
  async findAllUsers(em?: EntityManager) {
    return this.withSystemManager(em, async manager =>
      manager.getRepository(SysUserEntity).find())
  }

  /**
   * @description find user by user id
   */
  async findUserByUserId(userId: string, em?: EntityManager) {
    return this.withSystemManager(em, async manager =>
      manager.getRepository(SysUserEntity).findOne({ where: { id: userId } }))
  }

  /**
   * @description find user by user name
   */
  async findUserByUserName(userName: string, em?: EntityManager) {
    return this.withSystemManager(em, async manager =>
      manager.getRepository(SysUserEntity).findOne({ where: { userName } }))
  }

  /**
   * @description 某部门集合下的全部 userId（数据权限二期批 1：部门移动/删除时的
   * 缓存失效反查腿 —— dept.service 经 DataScopeService.invalidateForDept* 调用）
   */
  async findUserIdsByDeptIds(deptIds: string[], em?: EntityManager): Promise<string[]> {
    if (deptIds.length === 0) {
      return []
    }

    return this.withSystemManager(em, async (manager) => {
      const rows = await manager.getRepository(SysUserEntity).find({
        where: { deptId: In(deptIds) },
        select: { id: true },
      })
      return rows.map(i => i.id)
    })
  }

  /**
   * @description find user by id and update（returnDocument: 'after' 语义：返回更新后行）
   */
  async findUserByIdAndUpdate(id: string, update: Partial<SysUserEntity>, em?: EntityManager) {
    return this.withSystemManager(em, async (manager) => {
      const repository = manager.getRepository(SysUserEntity)

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
    })
  }

  /**
   * @description check user existence by payload, return user if existed, otherwise return null
   */
  async checkUserExistence(payload: Partial<SysUserEntity>, em?: EntityManager) {
    return this.withSystemManager(em, async manager =>
      manager.getRepository(SysUserEntity).findOne({ where: payload as never }))
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

    // 无 em 时必须是 system 事务（不是裸 dataSource.transaction）：事务里要有
    // set_config，否则 sys_user 的 INSERT 会撞 fail-closed 策略。
    return this.withSystemManager(em, run)
  }

  /**
   * @description 某 user 的角色行（Mongo 版 populate virtual 的 junction 读腿）。
   * 对照 Mongo 版 populate 无 match —— 不筛 role.status，状态判定在业务层
   * （user.shared.checkUserAndRoleStatus）。
   */
  async populatedRolesList(userId: string, em?: EntityManager): Promise<SysRoleEntity[]> {
    // sys_role / sys_user_role 都是 RLS 豁免表（junction 与全局配置），池级 manager 安全
    return (em ?? this.dataSource.manager)
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
