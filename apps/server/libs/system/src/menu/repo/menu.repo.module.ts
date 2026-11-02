import { Global, Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysMenuEntity } from '../entity/menu.entity'
import { SysMenuRepositoryService } from './menu.repo.service'

/**
 * B5 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态）。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([SysMenuEntity], WalnutPGConnectionName),
  ],
  controllers: [],
  providers: [SysMenuRepositoryService],
  exports: [SysMenuRepositoryService],
})
export class SysMenuRepositoryModule { }
