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

export interface IWalnutAdminRequestListDTOOptions {
  /**
   * L2 sort 白名单收敛：`sort[].field` 的显式白名单 = 「有索引支撑的列 ∪ 业务上
   * 确实会排序的列」。缺省（不传）仍是 DTO 全部属性 —— 保守兼容存量调用。
   *
   * 生效边界（L2 时点的现状，改动前先读）：全局 ValidationPipe 对 list DTO 的
   * `sort` 数组**不做嵌套校验**（validateOptions.required: false → Allow，无
   * ValidateNested），本白名单当前是「swagger 契约声明 + 未来开启嵌套校验时的闸」；
   * 查询层的真正防御收敛在 pg-list.builder（只收实体列）与各模块自定义 SQL 的
   * SORT 映射。因此收紧这里不会 400 掉任何存量请求，只会让契约面与实际可排序面一致。
   */
  sortOnlyIn?: readonly string[]
}

// create request list dto based on target dto
export function CreateWalnutAdminRequestListDTO<T>(
  dto: ClassConstructor<T>,
  options?: IWalnutAdminRequestListDTOOptions,
) {
  const keys = options?.sortOnlyIn
    ?? Object.keys(plainToInstance(dto as ClassConstructor<object>, {}, {}))

  class SortDTO {
    @WalnutAdminDecoratorFieldString({
      swaggerOptions: { title: 'sort field name' },
      validateOptions: {
        onlyIn: [...keys],
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
