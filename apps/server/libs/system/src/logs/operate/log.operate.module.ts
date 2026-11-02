import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysLogOperateEntity } from './entity/log-operate.entity'
import { SysLogOperateBasicRepository } from './log.operate.basic.repository'
import { sysLogOperateRecoverableProvider } from './log.operate.recoverer'
import { SysLogOperateService } from './log.operate.service'
import { SysLogOperateRepoModule } from './repo/log.operate.repo.module'

/**
 * B8 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysLogOperateEntity], WalnutPGConnectionName),
    SysLogOperateRepoModule,
  ],
  controllers: [],
  providers: [SysLogOperateBasicRepository, SysLogOperateService, sysLogOperateRecoverableProvider],
  exports: [SysLogOperateService],
})
export class SysLogOperateModule {}
