import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
} from '@walnut/decorators/field'
import { Expose, Type } from 'class-transformer'

import { ValidateNested } from 'class-validator'
import { SharedAreaModel } from '../schema/area.schema'

export class SharedAreaDTO extends SharedAreaModel {
  constructor(partial?: Partial<SharedAreaDTO>) {
    super()
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'depth, 0,1,2,3,4',
    },
    validateOptions: {
      onlyIn: [0, 1, 2, 3, 4],
    },
  })
  depth: number

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'leaf flag',
    },
  })
  isLeaf: boolean

  @Expose()
  @Type(() => SharedAreaDTO)
  @ValidateNested({ each: true })
  children: SharedAreaDTO[]
}
