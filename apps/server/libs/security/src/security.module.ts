import { Module } from '@nestjs/common'
import { SecurityRsaModule } from '@walnut-server/rsa'
import { SecurityCapModule } from './cap/cap.module'
import { SecurityRiskModule } from './risk/risk.module'
import { SecuritySensitiveModule } from './sensitive/sensitive.module'
import { SecuritySignModule } from './sign/sign.module'

/**
 * security 域的聚合模块（libs 解耦批 8）。
 *
 * app 的 `modules/security/security.module.ts` 只 import 本聚合并声明 4 个 controller
 * （rsa / sign / cap / sensitive）。子模块接入顺序与解耦前 `SecurityModule` 完全一致
 * （rsa → sign → cap → risk → sensitive），Swagger 路径顺序不变。
 *
 * 批 5 已下沉的 `SecurityRsaModule`（@Global）在这里并回聚合；risk / sensitive 的
 * @Global 语义保持（app 的失败登录收集端口、guard 链注入面不受影响）。
 */
@Module({
  imports: [
    SecurityRsaModule,
    SecuritySignModule,
    SecurityCapModule,
    SecurityRiskModule,
    SecuritySensitiveModule,
  ],
  exports: [
    SecurityRsaModule,
    SecuritySignModule,
    SecurityCapModule,
    SecurityRiskModule,
    SecuritySensitiveModule,
  ],
})
export class SysSecurityModule {}
