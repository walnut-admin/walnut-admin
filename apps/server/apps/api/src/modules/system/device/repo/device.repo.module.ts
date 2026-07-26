import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysDeviceSchema } from '../schema/device.schema'
import { SysDeviceRepositoryService } from './device.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_DEVICE, schema: SysDeviceSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysDeviceRepositoryService],
  exports: [SysDeviceRepositoryService],
})
export class SysDeviceRepositoryModule {}
