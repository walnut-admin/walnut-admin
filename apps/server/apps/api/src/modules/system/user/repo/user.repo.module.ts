import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysUserSchema } from '../schema/user.schema'
import { SysUserRepositoryService } from './user.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_USER, schema: SysUserSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysUserRepositoryService],
  exports: [SysUserRepositoryService],
})
export class SysUserRepositoryModule {}
