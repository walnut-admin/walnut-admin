import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'

import { Expose, Type } from 'class-transformer'

import { ValidateNested } from 'class-validator'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/area.schema.ts 的 SharedAreaModel，
// 改名 SharedAreaDTOBase），装饰器与字段本体零改动
export class SharedAreaDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'unique area code, length 1/2/4/6/9',
    },
  })
  code: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'area name',
    },
  })
  name: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'parent area code',
    },
  })
  pcode: string
}

export class SharedAreaDTO extends SharedAreaDTOBase {
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
