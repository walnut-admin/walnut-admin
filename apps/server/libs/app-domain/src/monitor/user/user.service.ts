import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'

import { AuthRefreshSharedService, AuthSignoutService } from '@walnut-server/auth'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { SysUserDeviceRepositoryService } from '@walnut-server/identity'
import { SysDeviceRepositoryService, SysDeviceSharedService } from '@walnut-server/system'
import { isNil } from 'lodash'
import { AppMonitorUserDTOBase } from './dto/user.dto'
import { AppMonitorUserRepositoryService } from './repo/user.repo.service'
import { AppMonitorUserBasicRepository } from './user.basic.repository'

/**
 * B6 迁移：monitor 列表聚合（$lookup device/user + matchConditions）改 basic repo 的
 * JOIN 版 `list()`；populate（read 的 device/user、updateState 的联动手腿）改按业务键
 * 应用层装回。事务句柄 `dbSession` → `em`。B7b 归一：doSignout 的 refresh 写腿亦迁
 * PG —— forceQuit 的双句柄收成单 em。
 */
@Injectable()
export class AppMonitorUserService {
  private readonly logger = new Logger(AppMonitorUserService.name)

  constructor(
    private readonly appMonitorUserBasicRepo: AppMonitorUserBasicRepository,
    private readonly sysUserDeviceRepo: SysUserDeviceRepositoryService,

    private readonly authRefreshSharedService: AuthRefreshSharedService,
    private readonly deviceSharedService: SysDeviceSharedService,
    private readonly deviceRepoService: SysDeviceRepositoryService,

    private readonly appMonitorUserRepoService: AppMonitorUserRepositoryService,
    private readonly signoutService: AuthSignoutService,
  ) { }

  /**
   * @description main service to update user state（心跳 upsert）
   *
   * ## 行键（批次 8 / B6，安全修复）
   *
   * 改造前：行键是**请求体**的 `visitorId`，而写进行里的 `deviceId` 来自 Cookie ——
   * 任何人把别人的 visitorId 塞进 body，就能把别人那一行的 `device_id` 改成自己的设备
   * （顺带覆盖 focus / left / currentRouter / user_id）：在线列表被投毒、
   * `sys_user_device` 被写成「受害者 + 攻击者设备」、`auth=false` 心跳还能反向清掉别人的关联。
   *
   * 现在：**行键是服务端从签名 Cookie 解析的 deviceId**（调用方传入，来自
   * `WalnutAdminDecoratorDeviceId`）。请求体的 `visitorId` 只作**校验**。
   *
   * ## visitorId 校验：与**本设备已存行**比（批次 11 / B5 收尾改写）
   *
   * B5 把 deviceId 改成**服务端随机签发**后，指纹与设备身份之间不再有可计算关系 ——
   * 旧判据 `HMAC(指纹) === deviceId` 对真实客户端**恒假**，于是每次心跳被自己拒成 40099。
   * 现在照 wire DTO 注释本来的口径（apps/api/src/modules/app/monitor/user/dto/user.dto.ts）
   * 改成「与本设备已存行的 `visitor_id` 比」：
   *
   * - 行不存在（首写）⇒ 以请求里的 `visitorId` 落库（它还决定 socket 房间键）；
   * - 行存在且 `row.visitorId !== body.visitorId` ⇒ 受控 40099，**不写库**。
   *
   * 为什么批次 8 担心的「抢注」在这里不成立：行键是**不可伪造的 deviceId**（服务端签发、
   * 随签名 cookie 携带）。攻击者抢得到的只是「自己那台设备」的首行 —— 他没法把受害者那一行
   * 的 `visitor_id` 改成别的，因为那需要受害者的 deviceId；受害者会看到的症状是「本设备
   * 被登记成另一个指纹」（他自己下一次心跳 40099），而不是批次 8 那种「别人的行被改写」。
   * 结构性残余：指纹与身份解耦后，「同一指纹的多台设备」不再有任何关联判据 —— 那是
   * 产品口径问题（指纹只作风控特征），不是这条校验能补的。
   *
   * 请求体的 `deviceId` 在 wire 层已被摘除（DTO 白名单 + forbidNonWhitelisted ⇒ 40099），
   * service 侧仍然显式把它钉成入参 deviceId，避免「展开顺序决定谁赢」的运气。
   */
  async updateState(
    deviceId: string,
    // P0-2：`visitorId`（原始指纹）已从 AppMonitorUserDTOBase 摘出（响应面不再回显）——
    // B6 起它是**校验字段**而不是行键，在交叉类型里显式声明，契约不藏在基座里。
    dto: Partial<AppMonitorUserDTOBase> & { visitorId?: string },
    em: EntityManager,
  ) {
    // P2-31（2026-10-29）：auth=false 的清零必须绕开下面的 nil 过滤 —— 旧实现先把
    // dto.userId 置 null 再按 `!isNil` 过滤，null 被丢掉，已存在的行继续挂着上次登录
    // 的用户（在线监控显示「已登出但仍是某人」，最长持续到 02:00 cron）。这里单独
    // 记一个显式清零标志，在 payload 里显式写入 null（列可空）。
    const clearUserId = dto.auth === false

    const updatePayload = Object.fromEntries(Object.entries(dto).filter(([_, v]) => !isNil(v)))
    if (clearUserId) {
      updatePayload.userId = null
    }

    const visitorId = dto.visitorId

    // 请求体不得携带 deviceId（wire 层已摘除；这里再挡一次，防止将来谁把字段加回 DTO）
    // —— 行键与写值只有一个真源：入参 deviceId（= 签名 Cookie 解析结果）。
    delete updatePayload.deviceId

    // visitorId 只作校验，判据落在「这台设备已经登记过哪个指纹」—— 行键是不可伪造的
    // deviceId，而 B5 之后指纹与身份之间没有可计算关系，没有比「已存行」更硬的判据。
    // 首写放行（登记），之后不一致即受控 40099，且**不写库**。
    if (!isNil(visitorId)) {
      const boundRow = await this.appMonitorUserRepoService.findFirstByDeviceId(deviceId, em)

      if (boundRow !== null && boundRow.visitorId !== visitorId) {
        throw new WalnutAdminExceptionRequestDataError(
          `monitor state visitorId does not belong to this device (device ${deviceId} is already bound to another visitorId)`,
        )
      }
    }

    // update doc（nil 值剔除；auth=false 的 userId 清零在上面显式补回）
    // 行键 = deviceId（服务端解析）；visitorId 已过归属校验，随首行登记落库。
    const doc = await this.appMonitorUserRepoService.findOneAndUpdate(
      { deviceId },
      { ...updatePayload, deviceId },
      { upsert: true },
      em,
    )

    if (!doc) {
      this.logger.error(`[UpdateState] | monitor user not found: ${deviceId}`)
      return false
    }

    // update user device last active at
    await this.sysUserDeviceRepo.updateUserDeviceLastActiveAt(deviceId, doc.userId?.toString(), em)

    // update device active status
    await this.deviceSharedService.updateDeviceActive(deviceId, !doc.left, em)

    return true
  }

  /**
   * @description force quit through monitorId
   * （B7b 归一：doSignout 的 refresh 写腿迁 PG —— 双句柄收成单 em）
   */
  async forceQuitByMonitorId(id: string, em?: EntityManager) {
    const appMonitor = await this.appMonitorUserRepoService.findByMonitorId(id, em)

    if (appMonitor === null) {
      this.logger.warn(`monitor user not found: ${id}`)
      return false
    }

    return this.signoutService.doSignout(
      appMonitor.userId as string,
      {
        trigger: 'admin-kick',
        deviceId: appMonitor.deviceId as string,
        fingerprint: appMonitor.visitorId,
        isOnline: !appMonitor.left,
      },
      em,
    )
  }

  /**
   * @description force quit through userId & deviceId, used for socket initial connection
   */
  async handleSocketInitForceQuit(userId: string, deviceId: string) {
    const { revoked, revokeReason } = await this.authRefreshSharedService.getTokenRevokedByDeviceIdAndUserId(deviceId, userId)

    if (revoked) {
      this.logger.log(
        `Device reconnect detected revoked token - user: ${userId}, device: ${deviceId}, reason: ${revokeReason}`,
      )

      // 只返回状态，不触发 doSignout
      return {
        shouldForceQuit: true,
        revokeReason,
      }
    }

    return {
      shouldForceQuit: false,
    }
  }

  /**
   * @description CRUD read
   * （Mongo 版 populate：device（deviceId/deviceName/deviceInfo/locationInfo/ip）与
   * user（_id/userName）→ PG 侧 device 直接按业务键取行；user 查 sys_user 同源表，
   * ETL 前为空数据窗口（phase3-plan §5））
   */
  async read(id: string) {
    const monitor = await this.appMonitorUserBasicRepo.readById(id)

    const device = monitor.deviceId !== null
      ? await this.deviceRepoService.findDeviceByDeviceId(monitor.deviceId)
      : null
    const user = monitor.userId !== null
      ? await this.appMonitorUserRepoService.findUserBriefById(monitor.userId)
      : null

    return { ...monitor, device, user }
  }

  /**
   * @description monitor list, support device/user info and filter
   * （Mongo 版 $lookup + matchConditions 聚合 → basic repo 的 JOIN 版 list）
   */
  async list<T>(params: IWalnutAdminRequestList<T>) {
    return this.appMonitorUserBasicRepo.list(params)
  }
}
