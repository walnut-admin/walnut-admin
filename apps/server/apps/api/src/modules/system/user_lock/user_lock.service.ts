import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { ClientSession, Types } from 'mongoose'

import { SysUserDeviceRepositoryService } from '../user_device/repo/user_device.repo.service'
import { SysUserLockDoLockDto, SysUserLockPreferenceDTO, SysUserLockUnLockDto } from './dto/user_lock.dto'
import { ISysUserLockModel, LockModeConst } from './schema/user_lock.schema'
import { SysUserLockSharedService } from './shared/user_lock.shared.service'

@Injectable()
export class SysUserLockService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_USER_LOCK)
    private readonly SysUserLockModel: ISysUserLockModel,

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
    const pref = await this.SysUserLockModel.findOne({ userId }).lean()
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
    const objId = new Types.ObjectId(userId)

    // get lock preference
    const lockPreferences = await this.SysUserLockModel.findOne({
      userId: objId,
    })

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
        ...lockPreferences.toObject(),
      }
    }
    else {
      // single device lock
      const deviceLocked = await this.userDeviceRepo.isDeviceLockedForUser(userId, deviceId)
      return {
        locked: deviceLocked,
        ...lockPreferences.toObject(),
      }
    }
  }

  /**
   * @description lock user account
   */
  async lock(userId: string, deviceId: string, fingerprint: string, { lockRoute }: SysUserLockDoLockDto, dbSession: ClientSession) {
    return this.userLockSharedService.lockUserDevice(userId, deviceId, fingerprint, lockRoute!, dbSession)
  }

  /**
   * @description unlock user account, if lockMode is security, then check password
   */
  async unlock(userId: string, deviceId: string, fingerprint: string, { lockPwdHash }: SysUserLockUnLockDto, dbSession: ClientSession) {
    return this.userLockSharedService.unLockUserDevice(userId, deviceId, fingerprint, lockPwdHash!, dbSession)
  }
}
