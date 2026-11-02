import { Module } from '@nestjs/common'
import { SysAuthModule } from '@walnut-server/auth'
import { AuthHttpModule } from './auth-http.module'

/**
 * auth 域组合根（libs 解耦批 8）。
 *
 * - 数据面在 libs：`SysAuthModule`（jwt / refresh / session / signout / shared / otp /
 *   google / opaque / mfa / oauth / cookie 的 service + strategy + module）。
 * - HTTP 组合根留 app：9 个 controller（依赖 `SysUserDTOSafe` wire DTO 与
 *   guard/decorator 层；log.auth decorator 已在 V5 下沉 `@walnut-server/guards`）与
 *   6 个 passport mixin guard，由 `AuthHttpModule`
 *   声明。模块装载顺序与解耦前一致，Swagger 路径顺序不变。
 */
@Module({
  imports: [SysAuthModule, AuthHttpModule],
})
export class AuthModule {}
