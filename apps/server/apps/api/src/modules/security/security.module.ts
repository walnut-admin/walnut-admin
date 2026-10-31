import { Module } from '@nestjs/common'
import { SecurityRsaModule } from '@walnut-server/rsa'
import { SecurityCapModule } from './cap/cap.module'
import { SecurityRiskModule } from './risk/risk.module'
import { SecurityRsaController } from './rsa/rsa.controller'
import { SecuritySensitiveModule } from './sensitive/sensitive.module'
import { SecuritySignModule } from './sign/sign.module'

/**
 * 安全域组合模块。
 *
 * 批 5：RSA 服务与模块下沉 `@walnut-server/rsa`（SecurityRsaModule 仍 @Global，导出
 * SecurityRsaService）；controller 留在 app 原位（路由/tag 不变），由本模块声明 ——
 * 模块装载顺序保持在 SecurityModule 的第一位，避免 Swagger 路径顺序漂移。
 */
@Module({
  imports: [
    SecurityRsaModule,
    SecuritySignModule,
    SecurityCapModule,
    SecurityRiskModule,
    SecuritySensitiveModule,
  ],
  controllers: [SecurityRsaController],
})
export class SecurityModule {}
