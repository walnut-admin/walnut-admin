import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
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
  ) {}

  private getDefaultLockPreference(): SysUserLockPreferenceDTO {
    return {
      locked: false,
      lockCrossDevice: false,
      lockRoute: null,
      lockMode: LockModeConst.DEFAULT,
      lockIdleSec: 300,
      lockSecuritySec: 60,
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
    if (lockPreferences.lockCrossDevice) {
      // check if any device is locked
      const anyDeviceLocked = await this.userDeviceRepo.isAnyDeviceLockedForUser(userId)
      return {
        locked: anyDeviceLocked,
        ...lockPreferences,
        // 实体列是 varchar（CHECK 枚举在 migration），DTO 侧收窄回 const 联合
        lockMode: lockPreferences.lockMode as ILockModeConst,
      }
    }
    else {
      // single device lock
      const deviceLocked = await this.userDeviceRepo.isDeviceLockedForUser(userId, deviceId)
      return {
        locked: deviceLocked,
        ...lockPreferences,
        lockMode: lockPreferences.lockMode as ILockModeConst,
      }
    }
  }

  /**
   * @description 更新锁屏偏好（P2-26，2026-10-29）
   *
   * - `lockMode=security` 必须带锁屏密码：本次 payload 带 `lockPwdHash`（明文）或库里
   *   已有 hash 均可，二者都没有 → 40000（`business.system.user.unLock.pwdRequired`）；
   * - `lockPwdHash` 的 bcrypt 只发生在仓库写入路径（`insertOrUpdateUserLockPre`）；
   * - 只写偏好，不改任何设备的 `locked` 状态（置锁/解锁仍走 lock/unlock）。
   */
  async updatePreference(userId: string, dto: SysUserLockPreferenceUpdateDto, em?: EntityManager) {
    const existing = await this.userLockRepo.findUserLockPreByUserId(userId, em)

    const hasSubmittedPwd = dto.lockPwdHash !== undefined && dto.lockPwdHash !== null && dto.lockPwdHash !== ''
    const hasStoredPwd = existing?.lockPwdHash !== undefined && existing?.lockPwdHash !== null && existing.lockPwdHash !== ''

    if (dto.lockMode === LockModeConst.SECURITY && !hasSubmittedPwd && !hasStoredPwd) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.user.unLock.pwdRequired' })
    }

    await this.userLockRepo.insertOrUpdateUserLockPre(userId, dto, em)

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
}
