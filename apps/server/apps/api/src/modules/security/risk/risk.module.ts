import { Global, Module } from '@nestjs/common'
import { SysUserIdentityRepositoryModule } from '@/modules/system/user_identity/repo/user_identity.repo.module'
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
  providers: services,
  exports: services,
})
export class SecurityRiskModule {}
