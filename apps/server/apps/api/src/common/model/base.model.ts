import { Prop } from '@nestjs/mongoose'
import {
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldMongoId,
} from '@walnut-server/decorators/field'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'

import { Types } from 'mongoose'

// HINT
// Since TypeScript does not store metadata about generics or interfaces,
// when you use them in your DTOs,
// ValidationPipe may not be able to properly validate incoming data.
// For this reason, consider using concrete classes in your DTOs.
// HINT
// When importing your DTOs,
// you can't use a type-only import as that would be erased at runtime,
// i.e. remember to import { CreateUserDto }
// instead of  import { CreateUserDto }

export class WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'default mongoDB id',
      description: '在入参时是可选并且被剔除了的，因为常规都会通过param去传Id',
      required: false,
    },
    transformOptions: {
      res: {
        toString: true,
      },
    },
  })
  @IsOptional({})
  @Expose({})
  _id: Types.ObjectId | string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'default createdAt',
      description:
        // TODO how did i exclude this field when request?
        'If you change the field name of createdAt through the schema configuration, omit the prop and declare your own time field. It is optional and eliminated when entering the parameter to prevent this field from being changed by mistake when modifying',
      required: false,
    },
  })
  @IsOptional({})
  @Expose({})
  @Prop({ type: Date })
  createdAt?: Date

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'default updatedAt',
      description:
        'If you change the field name of updatedAt through the schema configuration, omit the prop and declare your own time field. It is optional and eliminated when entering the parameter to prevent this field from being changed by mistake when modifying',
      required: false,
    },
  })
  @IsOptional({})
  @Expose({})
  @Prop({ type: Date })
  updatedAt?: Date
}
