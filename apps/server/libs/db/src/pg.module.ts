import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'

import { WalnutPGConnectionName } from './pg.const'
import { WalnutPGConfigService } from './pg.service'

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      name: WalnutPGConnectionName,
      useClass: WalnutPGConfigService,
    }),
  ],
})
export class WalnutPGModule {}
