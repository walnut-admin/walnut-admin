import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { AppTechCacheLockService } from '@walnut-server/cache'
import { runAfterCommit } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { ValueOf } from 'easy-fns-ts'

import { SysUserDeviceRepositoryService } from '../user_device/repo/user_device.repo.service'
import { SysUserLockDoLockDto, SysUserLockPreferenceDTO, SysUserLockPreferenceUpdateDto, SysUserLockUnLockDto } from './dto/user_lock.dto'
import { LockModeConst } from './lock.const'
import { SysUserLockRepositoryService } from './repo/user_lock.repo.service'
import { SysUserLockSharedService } from './shared/user_lock.shared.service'

type ILockModeConst = ValueOf<typeof LockModeConst>

/**
 * B7b 迁移：Mongo model 直持 → SysUserLockRepositoryService（PG）。
 * 方法签名 `dbSession: ClientSession` → `em?: EntityManager`，纯透传。
 */
@Injectable()
export class SysUserLockService {
  constructor(
    private readonly userLockRepo: SysUserLockRepositoryService,

    private readonly userDeviceRepo: SysUserDeviceRepositoryService,
    private readonly userLockSharedService: SysUserLockSharedService,
    private readonly lockCacheService: AppTechCacheLockService,
  ) {}

  private getDefaultLockPreference(): SysUserLockPreferenceDTO {
    return {
      locked: false,
      lockCrossDevice: false,
      lockRoute: null,
      lockMode: LockModeConst.DEFAULT,
      lockIdleSec: 300,
      lockSecuritySec: 60,
      lockPwdSet: false,
    }
  }

  /**
   * @description check lock status for guard
   */
  async getLockForGuard(userId: string, deviceId: string) {
    const pref = await this.userLockRepo.findUserLockPreByUserId(userId)
    const isCrossDevice = pref?.lockCrossDevice ?? false

    const isLocked = isCrossDevice
      ? await this.userDeviceRepo.isAnyDeviceLockedForUser(userId)
      : await this.userDeviceRepo.isDeviceLockedForUser(userId, deviceId)

    return {
      isLocked,
      isCrossDevice,
    }
  }

  /**
   * @description get lock status
   */
  async getLockStatusForUser(userId: string, deviceId: string): Promise<SysUserLockPreferenceDTO> {
    // get lock preference
    const lockPreferences = await this.userLockRepo.findUserLockPreByUserId(userId)

    // return default lock preference if not found
    if (!lockPreferences) {
      return this.getDefaultLockPreference()
    }

    // cross device lock
    const locked = lockPreferences.lockCrossDevice
      ? await this.userDeviceRepo.isAnyDeviceLockedForUser(userId)
      : await this.userDeviceRepo.isDeviceLockedForUser(userId, deviceId)

    // D9 / R1 修复（2026-11-27）：**逐字段显式构造**，不再整体 spread 实体 ——
    // `lock_pwd_hash` 从读腿就进不了响应装配面（旧实现靠 ClassSerializerInterceptor
    // 的 excludeExtraneousValues 兜底，改一行就泄），这里只回布尔 `lockPwdSet`。
    return {
      locked,
      lockRoute: lockPreferences.lockRoute ?? null,
      lockCrossDevice: lockPreferences.lockCrossDevice,
      // 实体列是 varchar（CHECK 枚举在 migration），DTO 侧收窄回 const 联合
      lockMode: lockPreferences.lockMode as ILockModeConst,
      lockIdleSec: lockPreferences.lockIdleSec,
      lockSecuritySec: lockPreferences.lockSecuritySec,
      lockPwdSet: lockPreferences.lockPwdHash !== null && lockPreferences.lockPwdHash !== '',
    }
  }

  /**
   * @description 更新锁屏偏好（P2-26，2026-10-29；L1 修订）
   *
   * - `lockMode=security` 必须带锁屏密码：本次 payload 带 `lockPwdHash`（明文）或库里
   *   已有 hash 均可，二者都没有 → 40000（`business.system.user.unLock.pwdRequired`）；
   * - `lockPwdHash: ''` 视为「不修改」（D2）：空串**不会**进入写入路径，哈希既不会被
   *   清空也不会被覆盖；密码长度 6–64 由 DTO 与这里各守一道；
   * - `lockCrossDevice` 变更时**清掉该用户的锁缓存**（D1）：缓存键的选择规则（全局 / 设备）
   *   刚被改写，旧键上的值不再有语义；
   * - 只写偏好，不改任何设备的 `locked` 状态（置锁/解锁仍走 lock/unlock）。
   */
  async updatePreference(userId: string, dto: SysUserLockPreferenceUpdateDto, em?: EntityManager) {
    const existing = await this.userLockRepo.findUserLockPreByUserId(userId, em)

    const trimmedPwd = typeof dto.lockPwdHash === 'string' ? dto.lockPwdHash : undefined
    // 空串 / 纯空白 = 不修改（D2：旧实现把 '' 原样写进 overwriteColumns，security 模式
    // 会因此变成「空哈希 + 永久解不开」）。长度校验是 DTO 之后的第二道（非 HTTP 调用方）。
    const hasSubmittedPwd = trimmedPwd !== undefined && trimmedPwd !== null && trimmedPwd.trim() !== ''
    const hasStoredPwd = existing?.lockPwdHash !== undefined && existing?.lockPwdHash !== null && existing.lockPwdHash !== ''

    if (hasSubmittedPwd && (trimmedPwd.length < 6 || trimmedPwd.length > 64)) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.user.unLock.pwdLength' })
    }

    if (dto.lockMode === LockModeConst.SECURITY && !hasSubmittedPwd && !hasStoredPwd) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.user.unLock.pwdRequired' })
    }

    // **null 必须一起摘掉**（2026-11-27 实测的既有缺陷）：DTO 的布尔字段 transformer
    // (`WalnutAdminDecoratorTransformerBoolean`) 对缺省值 toClassOnly 返回 **null**，
    // 于是「只发 lockMode + lockPwdHash」的请求会带着 `lockCrossDevice: null` 进写入路径
    // ⇒ `lock_cross_device` NOT NULL 违约、首次写入直接 50000。旧用例恰好每次都带全字段
    // 才没暴露。对偏好写入而言，null 与 undefined 同为「本次不改」，统一摘除。
    const payload: Partial<SysUserLockPreferenceUpdateDto> = {}
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined && value !== null) {
        (payload as Record<string, unknown>)[key] = value
      }
    }

    if (!hasSubmittedPwd) {
      // `''` / 纯空白一律摘键：仓库写入路径也就不会把它当成「新密码」
      delete payload.lockPwdHash
    }

    await this.userLockRepo.insertOrUpdateUserLockPre(userId, payload, em)

    // D1：切跨设备开关 = 换缓存键空间 —— 提交后清掉该用户全部锁缓存，让守卫回源 DB
    if (dto.lockCrossDevice !== undefined) {
      await runAfterCommit(async () => {
        await this.lockCacheService.clearUserLockCache(userId)
      })
    }

    return true
  }

  /**
   * @description lock user account
   */
  async lock(userId: string, deviceId: string, fingerprint: string, { lockRoute }: SysUserLockDoLockDto, em?: EntityManager) {
    return this.userLockSharedService.lockUserDevice(userId, deviceId, fingerprint, lockRoute!, em)
  }

  /**
   * @description unlock user account, if lockMode is security, then check password
   */
  async unlock(userId: string, deviceId: string, fingerprint: string, { lockPwdHash }: SysUserLockUnLockDto, em?: EntityManager) {
    return this.userLockSharedService.unLockUserDevice(userId, deviceId, fingerprint, lockPwdHash!, em)
  }

  /**
   * 方案①：登录口令（OPAQUE）验证通过后就地解锁（`POST /system/user/lock/verify/finish`）。
   */
  async unlockAfterCredentialVerified(userId: string, deviceId: string, fingerprint: string, em?: EntityManager) {
    return this.userLockSharedService.unlockAfterCredentialVerified(userId, deviceId, fingerprint, em)
  }

  /**
   * fallback 验证失败计数（Q7：与锁屏密码解锁共用一套预算）。
   */
  async recordFallbackVerifyFailure(userId: string) {
    return this.userLockSharedService.recordFallbackVerifyFailure(userId)
  }

  /**
   * 退避期校验（verify/start 与 verify/finish 的入口闸）。
   */
  async assertUnlockBackoffForUser(userId: string, em?: EntityManager) {
    return this.userLockSharedService.assertUnlockBackoffForUser(userId, em)
  }

  /**
   * 方案②：完整登录成功后的按偏好解锁（登录漏斗调用）。
   */
  async unlockOnLoginSuccess(userId: string, deviceId: string, em?: EntityManager) {
    return this.userLockSharedService.unlockOnLoginSuccess(userId, deviceId, em)
  }

  /**
   * Q6：管理员重置某用户的锁屏（只解锁 + 清计次，不读不碰 hash）。
   */
  async resetUserLockByAdmin(userId: string, em?: EntityManager) {
    return this.userLockSharedService.resetUserLockByAdmin(userId, em)
  }
}
