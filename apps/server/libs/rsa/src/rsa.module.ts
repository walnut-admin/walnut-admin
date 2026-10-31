import { Global, Module } from '@nestjs/common'
import { SecurityRsaService } from './rsa.service'

/**
 * RSA 服务模块（libs 解耦批 5 从 `modules/security/rsa/` 下沉）。
 *
 * 保持 @Global（解耦前同款）：decrypt/encrypt 拦截器与 rsa.controller 都直接注入
 * `SecurityRsaService`。controller 留在 app（swagger 路由归属不变），由
 * `SecurityModule` 声明；密钥材料经 `WALNUT_ADMIN_KEY_STORE` 端口由
 * `libs/app-domain` 的 AppKeyModule（@Global）绑定。
 */
@Global()
@Module({
  providers: [SecurityRsaService],
  exports: [SecurityRsaService],
})
export class SecurityRsaModule {}
