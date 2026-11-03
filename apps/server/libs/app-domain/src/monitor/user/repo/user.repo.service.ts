/* eslint-disable no-restricted-syntax -- 在线监控的系统通道：state/心跳/force-quit 走 socket 与守卫旁路（无 ALS 上下文），按 visitorId/deviceId 记账；面向管理端的 list/read 走 AppMonitorUserBasicRepository（已注入数据权限）。 */
import type { IIdentityMonitorRepository } from '@walnut-server/identity'
import type { IWalnutAdminSystemMonitorActiveUserReader } from '@walnut-server/system'
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName, withWalnutSystemManager } from '@walnut-server/db'
import { DataSource } from 'typeorm'
import { AppMonitorUserEntity } from '../entity/monitor-user.entity'

export interface IMonitorPopulatedUserBrief {
  id: string
  userName: string | null
}

/**
 * B6 迁移：Mongo model → PG 命名连接 DataSource。
 *
 * - userId / deviceId 是松引用（phase2 4.21 不建 FK）：user 侧查 PG `sys_user` 同源表
 *   （B7 注册实体后换实体 JOIN；ETL 前为空数据窗口，phase3-plan §5）；
 * - 事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（缺省连接级 manager）。
 */
@Injectable()
/** 批 6：implements 是端口绑定的编译期守护（user_device 只认端口）。 */
export class AppMonitorUserRepositoryService implements IIdentityMonitorRepository, IWalnutAdminSystemMonitorActiveUserReader {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 数据权限三期：app_monitor_user / sys_user 都已注册 RLS（缺省 anonymous）。
   * 在线监控的 state/心跳/force-quit 走 socket 与守卫旁路（无请求事务），必须显式
   * system 事务；管理端 list/read 走基类仓库（scoped），不受这里影响。
   */
  private async withSystemManager<T>(em: EntityManager | undefined, fn: (manager: EntityManager) => Promise<T>) {
    return withWalnutSystemManager(this.dataSource, em, fn)
  }

  /**
   * @description find monitor by filter and update
   * （Mongo 版 findOneAndUpdate(filter, update, options) 的窄化等价：命中即整体赋值
   * 保存，未命中且 upsert 时插入后回读（让 DB 默认值列进实体），未命中且非 upsert 返回 null）
   *
   * ## 行键（批次 8 / B6）
   *
   * `filter` 现在是**业务键 device_id**（服务端从签名 Cookie 解析），不再是请求体里的
   * visitorId —— 后者由客户端自报，拿它当行键等于把别人的行交出去。
   *
   * 指纹校验（`HMAC(visitorId) === deviceId`）在 **service** 层做：那是「客户端自报值是否
   * 与设备身份自洽」的策略判定，不是数据访问；repo 只认 filter。
   */
  async findOneAndUpdate(
    filter: { deviceId: string },
    update: Partial<AppMonitorUserEntity>,
    options: { upsert: boolean },
    em?: EntityManager,
  ) {
    return this.withSystemManager(em, async (manager) => {
      const repository = manager.getRepository(AppMonitorUserEntity)

      const target = await repository.findOne({ where: filter })

      if (!target) {
        if (!options.upsert) {
          return null
        }

        // 首行登记：visitorId 由 service 校过 HMAC 后随 update 一起落库
        await repository.insert({ ...filter, ...update })
        return repository.findOne({ where: filter })
      }

      Object.assign(target, update)
      return repository.save(target)
    })
  }

  /**
   * @description find monitor by monitor user document id
   */
  async findByMonitorId(id: string, em?: EntityManager) {
    return this.withSystemManager(em, async manager =>
      manager.getRepository(AppMonitorUserEntity).findOne({ where: { id } }))
  }

  /**
   * @description find active monitor by device id (not left)
   */
  async findActiveByDeviceId(deviceId: string) {
    return this.withSystemManager(undefined, async manager =>
      manager.getRepository(AppMonitorUserEntity).findOne({ where: { left: false, deviceId } }))
  }

  /**
   * @description find first monitor by device id（对齐 Mongo 版 deviceId virtual
   * justOne 的"任取一行"语义，不筛 left）
   */
  async findFirstByDeviceId(deviceId: string, em?: EntityManager) {
    return this.withSystemManager(em, async manager =>
      manager.getRepository(AppMonitorUserEntity).findOne({ where: { deviceId } }))
  }

  /**
   * @description delete monitor by device id
   */
  async delMonitorByDeviceId(deviceId: string) {
    return this.withSystemManager(undefined, async (manager) => {
      const repository = manager.getRepository(AppMonitorUserEntity)
      const target = await repository.findOne({ where: { deviceId } })
      if (!target) {
        return null
      }

      const snapshot = { ...target }
      await repository.remove(target)
      return snapshot
    })
  }

  /**
   * @description find all monitors by user id
   */
  async findAllByUserId(userId: string) {
    return this.withSystemManager(undefined, async manager =>
      manager.getRepository(AppMonitorUserEntity).find({ where: { userId } }))
  }

  /**
   * @description find monitor by user id and device id
   */
  async findByUserIdAndDeviceId(userId: string, deviceId: string, em?: EntityManager) {
    return this.withSystemManager(em, async manager =>
      manager.getRepository(AppMonitorUserEntity).findOne({ where: { userId, deviceId } }))
  }

  /**
   * @description find monitor with populated user
   * （Mongo 版 populate(USER, select nickName userName) → PG 侧按 user_id 查 sys_user
   * 同源表；B7 注册 SysUserEntity 后换实体 JOIN）
   */
  async findActiveUserByDeviceId(deviceId: string) {
    return this.withSystemManager(undefined, async (manager) => {
      const monitorData = await manager.getRepository(AppMonitorUserEntity)
        .findOne({ where: { left: false, deviceId } })

      if (monitorData === null || monitorData.userId === null) {
        return null
      }

      return this.findUserBriefById(monitorData.userId, manager)
    })
  }

  /**
   * @description 按行 id 查 sys_user 简要字段（read 的 user 出参）
   */
  async findUserBriefById(userId: string, em?: EntityManager) {
    return this.withSystemManager(em, async (manager) => {
      const user = await manager
        .createQueryBuilder()
        .select('u.id', 'id')
        .addSelect('u.user_name', 'userName')
        .addSelect('u.nick_name', 'nickName')
        .from('sys_user', 'u')
        .where('u.id = :userId', { userId })
        .getRawOne<{ id: string, userName: string | null, nickName: string | null }>()

      if (!user) {
        return null
      }

      return user
    })
  }

  /**
   * @description 更新 monitor 行（cron 任务把过期访客置为未认证，对照 Mongo 版
   * `monitorData.save()`）
   */
  async updateAuthState(monitor: AppMonitorUserEntity, em?: EntityManager) {
    return this.withSystemManager(em, async (manager) => {
      monitor.auth = false
      monitor.userId = null
      return manager.getRepository(AppMonitorUserEntity).save(monitor)
    })
  }
}
