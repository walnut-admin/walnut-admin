import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut/db'
import { AuthRefreshTokenSchema } from '../schema/refresh.schema'
import { AuthRefreshRepositoryService } from './refresh.repo.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.AUTH_REFRESH_TOKEN,
          schema: AuthRefreshTokenSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [],
  providers: [AuthRefreshRepositoryService],
  exports: [AuthRefreshRepositoryService],
})
export class AuthRefreshRepositoryModule { }
