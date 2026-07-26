import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName } from '@walnut/db'
import { WalnutDBConfigService } from './db.service'

@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: WalnutDBConnectionName,
      useClass: WalnutDBConfigService,
    }),
  ],
  providers: [],
  exports: [],
})
export class WalnutDBModule {}
