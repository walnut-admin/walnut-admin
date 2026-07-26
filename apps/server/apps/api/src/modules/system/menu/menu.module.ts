import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { SysLocaleSharedModule } from '../locale/shared/locale.shared.module'
import { SysMenuBasicRepository } from './menu.basic.repository'
import { SysMenuController } from './menu.controller'
import { SysMenuService } from './menu.service'
import { SysMenuRepositoryModule } from './repo/menu.repo.module'
import { SysMenuSchema } from './schema/menu.schema'
import { SysMenuSharedModule } from './shared/menu.shared.module'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_MENU, schema: SysMenuSchema }],
      WalnutDBConnectionName,
    ),
    SysMenuRepositoryModule,
    SysMenuSharedModule,
    SysLocaleSharedModule,
  ],
  controllers: [SysMenuController],
  providers: [SysMenuBasicRepository, SysMenuService],
  exports: [SysMenuService],
})
export class SysMenuModule {}
