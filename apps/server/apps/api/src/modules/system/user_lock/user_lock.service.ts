import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { ValueOf } from 'easy-fns-ts'

import { SysUserDeviceRepositoryService } from '../user_device/repo/user_device.repo.service'
import { SysUserLockDoLockDto, SysUserLockPreferenceDTO, SysUserLockUnLockDto } from './dto/user_lock.dto'
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
