import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { AppMonitorUserEntity } from '../entity/monitor-user.entity'
import { AppMonitorUserRepositoryService } from './user.repo.service'

/**
 * B6 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AppMonitorUserEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [AppMonitorUserRepositoryService],
  exports: [AppMonitorUserRepositoryService],
})
export class AppMonitorUserRepositoryModule { }
