import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WALNUT_ADMIN_KEY_STORE } from '@walnut-server/rsa'

import { AppKeyEntity } from './entity/key.entity'
import { AppKeyBasicRepository } from './key.basic.repository'
import { AppKeyController } from './key.controller'
import { AppKeyCurrentGuard } from './key.current.guard'
import { appKeyRecoverableProvider } from './key.recoverable'
import { AppKeyService } from './key.service'

/**
 * B4 迁移（接线形态同 demo.module，B1 确立）：Mongo forFeature 摘除，换 PG forFeature；
 * service 原先直持 model，随迁移补 AppKeyBasicRepository（PG）。消费方 security/rsa 与
 * techniques/task 不动（AppKeyModule 的 exports 面不变）。
 *
 * 批 5：@Global 化 —— libs/rsa 的 SecurityRsaService 在 lib 模块里注入
 * `WALNUT_ADMIN_KEY_STORE` 端口，绑定必须对其它模块全局可见（同 AppTokenModule 绑
 * WALNUT_ADMIN_TOKEN_TTL 的形态）。`AppKeyService implements IWalnutAdminKeyStore`。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AppKeyEntity], WalnutPGConnectionName),
  ],
  controllers: [AppKeyController],
  providers: [AppKeyBasicRepository, AppKeyService, AppKeyCurrentGuard, {
    provide: WALNUT_ADMIN_KEY_STORE,
    useExisting: AppKeyService,
  }, appKeyRecoverableProvider],
  exports: [AppKeyService, WALNUT_ADMIN_KEY_STORE],
})
export class AppKeyModule {}
