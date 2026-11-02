import { Injectable, Logger } from '@nestjs/common'
// Note: IWalnutAdminThrottleConfigProvider has been moved to global IWalnutAdminThrottleConfigProvider

@Injectable()
export class SysDeviceSettingService implements IWalnutAdminThrottleConfigProvider {
  private readonly logger = new Logger(SysDeviceSettingService.name)

  constructor() { }

  // implement IThrottleConfigProvider methods
  async getThrottleLimit() {
    const value = 4

    return value
  }

  // implement IThrottleConfigProvider methods
  async getThrottleTtl() {
    const value = 60

    return value
  }
}
