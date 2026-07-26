import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'

import { AppKeyController } from './key.controller'
import { AppKeyService } from './key.service'
import { AppKeySchema } from './schema/key.schema'

@Module({
  imports: [
    MongooseModule.forFeature(
      [{ name: WalnutDBModelName.APP_KEY, schema: AppKeySchema }],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [AppKeyController],
  providers: [AppKeyService],
  exports: [AppKeyService],
})
export class AppKeyModule {}
