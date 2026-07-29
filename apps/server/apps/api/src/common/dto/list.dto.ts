import {
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'

import { SortOrderValues } from '@walnut/contract'
import {
  ClassConstructor,
  plainToInstance,
} from 'class-transformer'
import { remove } from 'lodash'

// request list page dto
class WalnutAdminRequestListPageDTO {
  @WalnutAdminDecoratorFieldNumber({
    default: 1,
    swaggerOptions: {
      title: 'page number',
    },
    validateOptions: { int: true, min: 1, positive: true },
    transformOptions: {
      req: {
        defaultTransform: true,
      },
    },
  })
  readonly page: number

  @WalnutAdminDecoratorFieldNumber({
    default: 10,
    swaggerOptions: {
      title: 'page size',
    },
    validateOptions: { int: true, min: 1, max: 9999, positive: true },
    transformOptions: {
      req: {
        defaultTransform: true,
      },
    },
  })
  readonly pageSize: number
}

// create request list dto based on target dto
export function CreateWalnutAdminRequestListDTO<T>(dto: ClassConstructor<T>) {
  const omitKeys = ['_id']
  const keys = remove(
    Object.keys(plainToInstance(dto as ClassConstructor<object>, {}, {})),
    i => !omitKeys.includes(i),
  )

  class SortDTO {
    @WalnutAdminDecoratorFieldString({
      swaggerOptions: { title: 'sort field name' },
      validateOptions: {
        onlyIn: keys,
      },
    })
    readonly field: string

    @WalnutAdminDecoratorFieldEnum(() => SortOrderValues, {
      swaggerOptions: { title: 'order type, ascend or descend' },
    })
    readonly order: typeof SortOrderValues[keyof typeof SortOrderValues] | false

    @WalnutAdminDecoratorFieldNumber({
      swaggerOptions: { title: 'order priority' },
      validateOptions: { int: true, positive: true },
    })
    readonly priority: number
  }

  class ListDTO {
    constructor(partial?: Partial<T>) {
      Object.assign(this, partial)
    }

    @WalnutAdminDecoratorFieldObject(dto, {
      default: {},
      swaggerOptions: {
        example: {
          field1: 'this is a string',
          field2: false,
          field3: 123,
        },
      },
      validateOptions: { required: false },
      transformOptions: {
        req: {
          defaultTransform: true,
        },
      },
    })
    readonly query: InstanceType<typeof dto>

    @WalnutAdminDecoratorFieldObject(SortDTO, {
      default: {},
      isArray: true,
      swaggerOptions: {
        example: [
          {
            field: 'field1',
            order: 'ascend',
            priority: 1,
          },
          {
            field: 'field2',
            order: 'descend',
            priority: 2,
          },
          {
            field: 'field3',
            order: false,
            priority: 3,
          },
        ],
      },
      validateOptions: { required: false },
      transformOptions: {
        req: {
          defaultTransform: true,
        },
      },
    })
    readonly sort: SortDTO[]

    @WalnutAdminDecoratorFieldObject(WalnutAdminRequestListPageDTO, {
      default: { page: 1, pageSize: 10 },
      swaggerOptions: {
        example: {
          page: 1,
          pageSize: 10,
        },
      },
      validateOptions: { required: false },
      transformOptions: {
        req: {
          defaultTransform: true,
        },
      },
    })
    readonly page: WalnutAdminRequestListPageDTO
  }

  return ListDTO
}

// create response list dto based on target dto
export function CreateWalnutAdminResponseListDTO<T>(dto: ClassConstructor<T>) {
  const dtoName = dto.name

  class WalnutAdminResponseListDTO {
    constructor(partial?: Partial<WalnutAdminResponseListDTO>) {
      Object.assign(this, partial)
    }

    @WalnutAdminDecoratorFieldObject(dto, {
      isArray: true,
      swaggerOptions: {
        title: 'list response data',
        isArray: true,
      },
    })
    readonly data: T[]

    @WalnutAdminDecoratorFieldNumber({
      swaggerOptions: {
        title: 'list total count',
      },
    })
    readonly total: number
  }

  // dynamic change class name (swagger relies on this)
  Object.defineProperty(WalnutAdminResponseListDTO, 'name', {
    value: `${dtoName}ListResponse`,
  })

  return WalnutAdminResponseListDTO
}

export type IWalnutAdminRequestList<T> = InstanceType<ReturnType<typeof CreateWalnutAdminRequestListDTO<T>>>

export type IWalnutAdminResponseList<T> = InstanceType<ReturnType<typeof CreateWalnutAdminResponseListDTO<T>>>
