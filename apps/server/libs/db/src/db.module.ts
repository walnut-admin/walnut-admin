import { Module } from '@nestjs/common'

import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName } from '@walnut-server/db'
import { WalnutDBConfigService } from './db.service'
import { WalnutPGModule } from './pg.module'

@Module({
  imports: [
    MongooseModule.forRootAsync({
      connectionName: WalnutDBConnectionName,
      useClass: WalnutDBConfigService,
    }),
    WalnutPGModule,
  ],
  providers: [],
  exports: [],
})
export class WalnutDBModule {}
