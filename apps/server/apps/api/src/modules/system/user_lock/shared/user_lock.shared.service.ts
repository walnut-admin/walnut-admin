import { Injectable } from '@nestjs/common'
import { registerAfterCommitHook } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'
import { ClientSession } from 'mongoose'
import { AppMonitorUserSharedService } from '@/modules/app/monitor/user/shared/user.shared.service'
import { AppTechCacheLockService } from '@/modules/techniques/cache/service/cache.lock'
import { WalnutAdminSocketEvents } from '@/socket/socket.const'
import { SocketService } from '@/socket/socket.service'
import { SysUserDeviceRepositoryService } from '../../user_device/repo/user_device.repo.service'
import { SysUserLockDto } from '../dto/user_lock.dto'
import { SysUserLockRepositoryService } from '../repo/user_lock.repo.service'

@Injectable()
export class SysUserLockSharedService {
  constructor(
    private readonly lockCacheService: AppTechCacheLockService,
    private readonly socketService: SocketService,
    private readonly userDeviceRepo: SysUserDeviceRepositoryService,
    private readonly userLockRepo: SysUserLockRepositoryService,
    private readonly appMonitorUserSharedService: AppMonitorUserSharedService,
  ) {}

  private async lockUserDeviceMainLogic(userId: string, deviceId: string, fingerprint: string, locked: boolean, lockPreference: SysUserLockDto, dbSession: ClientSession) {
    const emitEvent = locked ? WalnutAdminSocketEvents.LOCK : WalnutAdminSocketEvents.UNLOCK
    const isCrossDevice = lockPreference.lockCrossDevice

    // cross device lock socket room emit
    if (isCrossDevice) {
      // update current user's all device lock status
      await this.userDeviceRepo.updateLockStatusForAllDevices(userId, locked, dbSession)

      // send socket emit to all auth online monitors
      await this.appMonitorUserSharedService.sendSocketEventToUserAllMonitors(userId, emitEvent)
    }
    else {
      // update current user's current device lock stauts
      await this.userDeviceRepo.updateLockStatusForThisUserAndThisDevice(userId, deviceId, locked, dbSession)

      // send specific socket event to current user device
      this.socketService.sendToUserRoom(userId, fingerprint, emitEvent)
    }

    // after dbSession endSession
    registerAfterCommitHook(async () => {
      await this.lockCacheService.setDeviceLockCache(userId, deviceId, isCrossDevice, locked)
    })

    return true
  }

  async lockUserDevice(userId: string, deviceId: string, fingerprint: string, lockRoute: object, dbSession: ClientSession) {
    const lockPreference = await this.userLockRepo.insertOrUpdateUserLockPre(userId, { lockRoute }, dbSession)
    return this.lockUserDeviceMainLogic(userId, deviceId, fingerprint, true, lockPreference, dbSession)
  }

  async unLockUserDevice(userId: string, deviceId: string, fingerprint: string, lockPwdHash: string, dbSession: ClientSession) {
    const lockPreference = await this.userLockRepo.findUserLockPreByUserId(userId, dbSession)
    if (!lockPreference) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    // check lock password hash
    if (lockPwdHash) {
      const isLockPwdValid = await this.userLockRepo.compareLockPwdHash(lockPwdHash, lockPreference.lockPwdHash)
      if (!isLockPwdValid) {
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.user.unLock.pwdErr' })
      }
    }

    return this.lockUserDeviceMainLogic(userId, deviceId, fingerprint, false, lockPreference, dbSession)
  }
}
