import { Module } from '@nestjs/common'
import { SecurityCapModule } from './cap/cap.module'
import { SecurityRiskModule } from './risk/risk.module'
import { SecurityRsaModule } from './rsa/rsa.module'
import { SecuritySensitiveModule } from './sensitive/sensitive.module'
import { SecuritySignModule } from './sign/sign.module'

@Module({
  imports: [
    SecurityRsaModule,
    SecuritySignModule,
    SecurityCapModule,
    SecurityRiskModule,
    SecuritySensitiveModule,
  ],
})
export class SecurityModule {}
