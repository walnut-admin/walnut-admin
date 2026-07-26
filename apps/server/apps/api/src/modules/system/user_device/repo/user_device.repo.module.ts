import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysUserDeviceSchema } from '../schema/user_device.schema'
import { SysUserDeviceRepositoryService } from './user_device.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_USER_DEVICE, schema: SysUserDeviceSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysUserDeviceRepositoryService],
  exports: [SysUserDeviceRepositoryService],
})
export class SysUserDeviceRepositoryModule { }
