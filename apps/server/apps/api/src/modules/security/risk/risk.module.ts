import { Global, Module } from '@nestjs/common'
import { SysUserIdentityRepositoryModule } from '@walnut-server/identity'
import { WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR } from '@walnut-server/system'
import { SecurityRiskChallengeStateService } from './modules/challenge.service'
import { SecurityRiskDeviceService } from './modules/device.service'
import { SecurityRiskFailedLoginService } from './modules/failedLogin.service'
import { SecurityRiskIPService } from './modules/ip.service'
import { SecurityRiskLocationService } from './modules/location.service'
import { SecurityRiskRateService } from './modules/rate.service'
import { SecurityRiskUserService } from './modules/user.service'
import { SecurityRiskUserDeviceService } from './modules/user_device.service'
import { SecurityRiskConfigService } from './risk.config.service'
import { SecurityRiskService } from './risk.service'

const services = [
  // Configuration service
  SecurityRiskConfigService,
  // Core risk assessment service
  SecurityRiskService,
  // Module services
  SecurityRiskIPService,
  SecurityRiskDeviceService,
  SecurityRiskFailedLoginService,
  SecurityRiskLocationService,
  SecurityRiskRateService,
  SecurityRiskUserService,
  SecurityRiskUserDeviceService,
  SecurityRiskChallengeStateService,
]

@Global()
@Module({
  imports: [SysUserIdentityRepositoryModule],
  providers: [
    ...services,
    // 批 7：libs/system 的认证日志只认这个端口（失败登录风控在 security 域）
    {
      provide: WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR,
      useExisting: SecurityRiskFailedLoginService,
    },
  ],
  exports: [...services, WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR],
})
export class SecurityRiskModule {}
