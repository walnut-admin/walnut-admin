import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SharedScopeResolverModule } from '@/modules/shared/scopeResolver/scope-resolver.module'
import { SysRoleSchema } from '../schema/role.schema'
import { SysRoleSharedService } from './role.shared.service'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.SYS_ROLE, schema: SysRoleSchema }],
      WalnutDBConnectionName,
    ),
    SharedScopeResolverModule,
  ],
  controllers: [],
  providers: [SysRoleSharedService],
  exports: [SysRoleSharedService],
})
export class SysRoleSharedModule {}
