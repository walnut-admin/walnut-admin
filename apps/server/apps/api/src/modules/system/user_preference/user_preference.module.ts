import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysUserPreferenceController } from './controllers/user_preference.controller'
import { SysUserPreferenceSchema } from './schema/user_preference.schema'
import { SysUserPreferenceService } from './services/user_preference.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_USER_PREFERENCE,
          schema: SysUserPreferenceSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [SysUserPreferenceController],
  providers: [SysUserPreferenceService],
  exports: [SysUserPreferenceService],
})
export class SysUserPreferenceModule {}
