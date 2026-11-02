import { Module } from '@nestjs/common'
import { SysRoleSharedModule } from '../../role/shared/role.shared.module'
import { SysMenuRepositoryModule } from '../repo/menu.repo.module'
import { SysMenuSharedService } from './menu.shared.service'

@Module({
  imports: [
    SysMenuRepositoryModule,
    SysRoleSharedModule,
  ],
  controllers: [],
  providers: [SysMenuSharedService],
  exports: [SysMenuSharedService],
})
export class SysMenuSharedModule { }
