import { Module } from '@nestjs/common'
import { SysSecurityModule } from '@walnut-server/security'
import { SecurityCapController } from './cap/cap.controller'
import { SecurityRsaController } from './rsa/rsa.controller'
import { SecuritySensitiveController } from './sensitive/sensitive.controller'
import { SecuritySignController } from './sign/sign.controller'

/**
 * security 域组合根（libs 解耦批 8）。
 *
 * - 数据面在 libs：`SysSecurityModule`（cap / risk / sensitive / sign + 批 5 的 rsa）。
 * - controller 留 app（依赖 guard / param decorator / log decorator 与 wire DTO），
 *   按解耦前子模块装载顺序声明（rsa → sign → cap → sensitive），Swagger 路径顺序不变。
 *
 * `SecurityRiskModule` / `SecurityRsaModule` 的 @Global 语义随 lib 聚合保持。
 */
@Module({
  imports: [SysSecurityModule],
  controllers: [
    SecurityRsaController,
    SecuritySignController,
    SecurityCapController,
    SecuritySensitiveController,
  ],
})
export class SecurityModule {}
