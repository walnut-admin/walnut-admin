import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'
import { SysRoleSchema } from '../schema/role.schema'
import { SysRoleRepoService } from './role.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SYS_ROLE,
          schema: SysRoleSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [SysRoleRepoService],
  exports: [SysRoleRepoService],
})
export class SysRoleRepoModule {}
