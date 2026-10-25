import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserPreferenceController } from './controllers/user_preference.controller'
import { SysUserPreferenceEntity } from './entity/user-preference.entity'
import { SysUserPreferenceService } from './services/user_preference.service'

/**
 * B7b 迁移：Mongo forFeature 摘除，换 PG forFeature（B1 确立的接线形态，不另建 pg.module）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SysUserPreferenceEntity], WalnutPGConnectionName),
  ],
  controllers: [SysUserPreferenceController],
  providers: [SysUserPreferenceService],
  exports: [SysUserPreferenceService],
})
export class SysUserPreferenceModule {}
