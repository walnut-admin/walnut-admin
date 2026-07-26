import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysMenuSchema } from '../schema/menu.schema'
import { SysMenuRepositoryService } from './menu.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_MENU, schema: SysMenuSchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysMenuRepositoryService],
  exports: [SysMenuRepositoryService],
})
export class SysMenuRepositoryModule { }
