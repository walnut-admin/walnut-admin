import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { WalnutDBConnectionName, WalnutDBModelName } from '@walnut-server/db'

import { SharedAreaController } from './area.controller'
import { SharedAreaService } from './area.service'
import { SharedAreaSchema } from './schema/area.schema'

@Module({
  imports: [
    MongooseModule.forFeature(
      [
        {
          name: WalnutDBModelName.SHARED_AREA,
          schema: SharedAreaSchema,
        },
      ],
      WalnutDBConnectionName,
    ),
  ],
  controllers: [SharedAreaController],
  providers: [SharedAreaService],
  exports: [SharedAreaService],
})
export class SharedAreaModule {}
