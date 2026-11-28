import type { EntityManager } from 'typeorm'
import { Inject, Injectable } from '@nestjs/common'
import { AppTechCacheLockService } from '@walnut-server/cache'
import { registerAfterCommitHook, runAfterCommit } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { WalnutAdminSocketEvents } from '@walnut/contract/socket'
import { IIdentityUserNotifier, WALNUT_ADMIN_IDENTITY_USER_NOTIFIER } from '../../identity.ports'
import { SysUserDeviceRepositoryService } from '../../user_device/repo/user_device.repo.service'
import { SysUserLockEntity } from '../entity/user-lock.entity'
import { getLockPwdRetryAfterSec } from '../lock-pwd-backoff'
import { LockModeConst } from '../lock.const'
import { SysUserLockRepositoryService } from '../repo/user_lock.repo.service'

@Injectable()
export class SysUserLockSharedService {
  constructor(
    private readonly lockCacheService: AppTechCacheLockService,
    private readonly userDeviceRepo: SysUserDeviceRepositoryService,
    private readonly userLockRepo: SysUserLockRepositoryService,
    @Inject(WALNUT_ADMIN_IDENTITY_USER_NOTIFIER)
    private readonly notifier: IIdentityUserNotifier,
  ) {}

  /**
   * B7b 迁移：lock preference（本模块）与 user_device 写腿均已是 PG —— B6 的双句柄
   * （em + dbSession）归一为单 `em`（事务内 manager，controller 传 ctx.em）。
   *
   * **I1（不变量，L1 起写进代码）**：`locked` 只有这一条写入腿。任何新解锁入口
   * （登录口令 fallback、登录即解锁、管理员重置中「按偏好」的部分）都走它；不允许
   * 在别处直接 UPDATE `sys_user_device.locked` 或直接写 Redis（管理员重置是唯一的
   * 「无视偏好、全设备」例外，见 `resetUserLockByAdmin`）。
   */
  private async lockUserDeviceMainLogic(
    userId: string,
    deviceId: string,
    fingerprint: string,
    locked: boolean,
    lockPreference: SysUserLockEntity,
    em?: EntityManager,
  ) {
    const emitEvent = locked ? WalnutAdminSocketEvents.LOCK : WalnutAdminSocketEvents.UNLOCK
    const isCrossDevice = lockPreference.lockCrossDevice

    // cross device lock socket room emit
    if (isCrossDevice) {
      // update current user's all device lock status
      await this.userDeviceRepo.updateLockStatusForAllDevices(userId, locked, em)

      // send socket emit to all auth online monitors
      await this.notifier.sendSocketEventToUserAllMonitors(userId, emitEvent)
    } else {
      // update current user's current device lock stauts
      await this.userDeviceRepo.updateLockStatusForThisUserAndThisDevice(
        userId,
        deviceId,
        locked,
        em,
      )

      // send specific socket event to current user device
      // 空 fingerprint = 调用方没有「当前浏览器」的指纹（登录即解锁路径）：该设备刚完成
      // 登录、自己会重新拉状态，不需要向别的房间广播（见 unlockOnLoginSuccess）。
      if (fingerprint !== '') {
        this.notifier.sendSocketEventToUserDevice(userId, fingerprint, emitEvent)
      }
    }

    // after commit
    registerAfterCommitHook(async () => {
      await this.lockCacheService.setDeviceLockCache(userId, deviceId, isCrossDevice, locked)
    })

    return true
  }

  async lockUserDevice(
    userId: string,
    deviceId: string,
    fingerprint: string,
    lockRoute: object,
    em?: EntityManager,
  ) {
    // 客户端未带路由时落 DB 默认空对象（jsonb '{}'），对齐实体的非空不变量
    const lockPreference = await this.userLockRepo.insertOrUpdateUserLockPre(
      userId,
      { lockRoute: lockRoute ?? {} },
      em,
    )
    return this.lockUserDeviceMainLogic(userId, deviceId, fingerprint, true, lockPreference, em)
  }

  /**
   * 记一次解锁失败并把「受控错误」抛出去（Q7 计次 / 退避）。
   *
   * 计次落在**独立事务**里（repo 的 `recordUnlockFailure`，理由见该方法注释）——
   * 本方法随后抛异常，请求事务回滚，但失败次数必须留下。
   *
   * 响应语义：40000 + `meta.retryAfterSec`（>0 表示已进入退避）+ `meta.failCount`。
   * 客户端据此显示倒计时；服务端**不**给「密码对不对」的额外信号。
   */
  private async recordUnlockFailureAndThrow(userId: string): Promise<never> {
    const result = await this.userLockRepo.recordUnlockFailure(userId)
    const retryAfterSec = result === null ? 0 : getLockPwdRetryAfterSec(result.lockedUntil)

    throw new WalnutAdminExceptionBadRequest({
      errMsg: 'business.system.user.unLock.pwdErr',
      meta: {
        failCount: result?.failCount ?? 1,
        ...(retryAfterSec > 0 ? { retryAfterSec } : {}),
      },
    })
  }

  /**
   * 退避期内一律拒绝（与密码对错无关 —— 避免「对密码也要等」退化成计时侧信道）。
   *
   * 只在 security 模式调用：default / idle 的解锁没有可暴力猜的凭据，不该被锁屏密码的
   * 失败预算牵连。
   */
  private assertNotInUnlockBackoff(lockPreference: SysUserLockEntity) {
    const retryAfterSec = getLockPwdRetryAfterSec(lockPreference.lockPwdLockedUntil)

    if (retryAfterSec > 0) {
      throw new WalnutAdminExceptionBadRequest({
        errMsg: 'business.system.user.unLock.pwdLocked',
        meta: {
          retryAfterSec,
          failCount: lockPreference.lockPwdFailCount,
        },
      })
    }
  }

  /**
   * 退避期校验（供 verify/* 在**开始 OPAQUE 交换之前**调用 —— 退避期连 start 也不给，
   * 省掉一次昂贵计算，也让客户端能立刻显示倒计时）。
   *
   * 无偏好行 / 非 security 模式 = 不拦（与 unlock 的口径一致）。
   */
  async assertUnlockBackoffForUser(userId: string, em?: EntityManager) {
    const lockPreference = await this.userLockRepo.findUserLockPreByUserId(userId, em)

    if (!lockPreference || lockPreference.lockMode !== LockModeConst.SECURITY) {
      return
    }

    this.assertNotInUnlockBackoff(lockPreference)
  }

  async unLockUserDevice(
    userId: string,
    deviceId: string,
    fingerprint: string,
    lockPwdHash: string,
    em?: EntityManager,
  ) {
    const lockPreference = await this.userLockRepo.findUserLockPreByUserId(userId, em)
    if (!lockPreference) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    // P2-26（2026-10-29）：lockMode=security 时解锁密码必填 —— 旧实现 lockPwdHash 可选，
    // 缺省直接跳过比对，security 模式的「密码解锁」语义形同虚设。
    const isSecurityMode = lockPreference.lockMode === LockModeConst.SECURITY
    const hasPwd = lockPwdHash !== undefined && lockPwdHash !== null && lockPwdHash !== ''

    // L1 / Q7：退避期拒绝先于密码比对（security 模式唯一入口）
    if (isSecurityMode) {
      this.assertNotInUnlockBackoff(lockPreference)
    }

    if (isSecurityMode && !hasPwd) {
      // fallback（verify/finish）成功后的**短时重试通道**：授权缓存单次消费、设备作用域。
      // 正常路径 verify/finish 已就地解锁；这里只兜「响应在网络上丢了、客户端重试」。
      const unlockAuth = await this.lockCacheService.consumeUnlockAuthCache(userId, deviceId)

      if (unlockAuth === null) {
        throw new WalnutAdminExceptionBadRequest({
          errMsg: 'business.system.user.unLock.pwdRequired',
        })
      }

      await this.userLockRepo.clearUnlockFailure(userId, em)
      return this.lockUserDeviceMainLogic(userId, deviceId, fingerprint, false, lockPreference, em)
    }

    // check lock password hash
    if (hasPwd) {
      if (lockPreference.lockPwdHash === null || lockPreference.lockPwdHash === '') {
        // security 模式却没有哈希 = 配置异常（D2 的翻车形态）。不计数（不是「猜错」），
        // 给出与密码错误同形的受控 40000，避免暴露配置细节。
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.user.unLock.pwdErr' })
      }

      const isLockPwdValid = await this.userLockRepo.compareLockPwdHash(
        lockPwdHash,
        lockPreference.lockPwdHash,
      )
      if (!isLockPwdValid) {
        // 计次只针对 security 模式（设计稿 §6.7：两个可爆破入口共用一套计数）
        if (isSecurityMode) {
          await this.recordUnlockFailureAndThrow(userId)
        }

        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.user.unLock.pwdErr' })
      }
    }

    // 成功解锁：清零计数与退避（与解锁执行腿同一事务提交）
    await this.userLockRepo.clearUnlockFailure(userId, em)

    return this.lockUserDeviceMainLogic(userId, deviceId, fingerprint, false, lockPreference, em)
  }

  /**
   * 方案①：登录口令（OPAQUE）验证通过后就地解锁。
   *
   * **不经过** `unLockUserDevice` 的密码比对 —— 凭据已在 OPAQUE 腿验证过，不要在同一条链
   * 上再要求一次锁屏口令。幂等：未锁也返回 true（偏好行缺失仍 40401，与 unlock 同语义）。
   */
  async unlockAfterCredentialVerified(
    userId: string,
    deviceId: string,
    fingerprint: string,
    em?: EntityManager,
  ) {
    const lockPreference = await this.userLockRepo.findUserLockPreByUserId(userId, em)
    if (!lockPreference) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    await this.userLockRepo.clearUnlockFailure(userId, em)

    const result = await this.lockUserDeviceMainLogic(
      userId,
      deviceId,
      fingerprint,
      false,
      lockPreference,
      em,
    )

    // sensitive_op 式的「解锁授权」：**单次消费、60s TTL、设备作用域**。它不改变解锁的
    // 真源（DB/执行腿已生效），只给「verify 成功但响应在网络上丢了」的客户端留一次
    // 免密重试（`unLockUserDevice` 在 security 模式无密码时消费它），见 cache.lock.ts。
    // 写在提交后：事务若回滚，这枚授权不得存在（否则等于给了密码旁路）。
    await runAfterCommit(async () => {
      await this.lockCacheService.setUnlockAuthCache(userId, deviceId, {
        at: Date.now(),
        method: 'loginPassword',
      })
    })

    return result
  }

  /**
   * fallback 验证失败时计数（供 verify/finish 调用；抛错由 controller 决定错误码）。
   * @returns 计数与退避状态（调用方据此决定 meta）
   */
  async recordFallbackVerifyFailure(userId: string) {
    const result = await this.userLockRepo.recordUnlockFailure(userId)
    const retryAfterSec = result === null ? 0 : getLockPwdRetryAfterSec(result.lockedUntil)

    return {
      failCount: result?.failCount ?? 0,
      retryAfterSec,
    }
  }

  /**
   * 方案②（I3）：一次**完整登录成功**后按 `lockCrossDevice` 解锁。
   *
   * - `lockCrossDevice=true` ⇒ 解全部设备 + 广播 UNLOCK（跨设备恢复通道）；
   * - `lockCrossDevice=false` ⇒ 只解当前设备（不广播：登录所在浏览器自己会重拉状态）。
   *
   * 只在「确实处于锁定态」时执行 —— 每次登录都广播 UNLOCK 会让其它被锁浏览器的
   * `unlockFromSocket` 误触发一次 `logicAfterUnlock` 跳转。
   *
   * 与 DuplicateSignIn 的组合（已核实，`refresh.shared.service.ts:325-333`）：同一
   * `(userId, deviceId)` 已有现役 RT 时 `generateRefreshToken` 会在本方法**之前**抛
   * 40109 —— 所以「同设备重新登录」不可达；可达的只有「换设备登录」或「先 signout
   * 再登录」，两者都是真实的新凭据证明，解锁语义成立。
   */
  async unlockOnLoginSuccess(userId: string, deviceId: string, em?: EntityManager) {
    const lockPreference = await this.userLockRepo.findUserLockPreByUserId(userId, em)

    // 没锁过（无偏好行）= 没有需要清的锁态与计数
    if (!lockPreference) {
      return false
    }

    const isLocked = lockPreference.lockCrossDevice
      ? await this.userDeviceRepo.isAnyDeviceLockedForUser(userId)
      : await this.userDeviceRepo.isDeviceLockedForUser(userId, deviceId)

    // 计数清零与是否锁定无关：解锁端点在没有锁屏的情况下也能被猜（计数可能 >0）
    await this.userLockRepo.clearUnlockFailure(userId, em)

    if (!isLocked) {
      return false
    }

    // fingerprint 传空：单设备分支不向「别的浏览器」广播（见 lockUserDeviceMainLogic）
    return this.lockUserDeviceMainLogic(userId, deviceId, '', false, lockPreference, em)
  }

  /**
   * Q6：管理员重置某用户的锁屏 —— **只解锁 + 清计次，不读不碰 `lock_pwd_hash`**。
   *
   * 与用户的解锁入口不同，这是运维兜底通道：忽略 `lockCrossDevice`，直接清该用户
   * **全部**设备的 `locked`（`sys_user_device.locked` 是锁屏真源），提交后清全部
   * `SECURITY:LOCK:<uid>:*` 缓存并广播 UNLOCK。哈希保持原样 —— 管理员既不能读到，
   * 也不能借此重置/绕过用户的锁屏密码（安全模式下次解锁仍需密码）。
   */
  async resetUserLockByAdmin(userId: string, em?: EntityManager) {
    await this.userDeviceRepo.updateLockStatusForAllDevices(userId, false, em)
    await this.userLockRepo.clearUnlockFailure(userId, em)

    registerAfterCommitHook(async () => {
      await this.lockCacheService.clearUserLockCache(userId)
      await this.notifier.sendSocketEventToUserAllMonitors(userId, WalnutAdminSocketEvents.UNLOCK)
    })

    return true
  }
}
