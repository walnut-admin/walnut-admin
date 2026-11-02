import {
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'

import { WALNUT_LIST_PAGE_SIZE_MAX } from '@walnut-server/utils/list-page'
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
    // 上限与 builder / logger / cache 的 clamp 同源（R3 P2-3：原先两处 9999 字面量，靠注释宣称同源）
    validateOptions: { int: true, min: 1, max: WALNUT_LIST_PAGE_SIZE_MAX, positive: true },
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
   * 生效边界（批次 1 起**已变**，改动前先读）：`sort` 槽位已挂 `nestedWhenPresent`
   * （见下面的 ListDTO），`field` 的 `onlyIn` 是**真校验**了 —— 传白名单外的字段会 400。
   * 查询层还有第二道收敛：pg-list.builder 只收实体列（`isPgSortableColumnKind`）。
   * `query` 槽位**仍未开**嵌套校验（理由见 ListDTO 里 query 那段注释）。
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
      // contract 的 SortOrder 允许 false = 该列不排序（pagination.ts:8）；
      // IsEnum 的枚举里没有 false，用 allowFalseValue 放行，其余值仍校验
      validateOptions: { allowFalseValue: true },
    })
    readonly order: typeof SortOrderValues[keyof typeof SortOrderValues] | false

    @WalnutAdminDecoratorFieldNumber({
      swaggerOptions: { title: 'order priority' },
      // R3 P2-4：nestedWhenPresent 打开后这里从"声明了但被忽略"变成真校验，而
      // 历史行为是允许缺省（builder 侧一直有 `priority ?? 0`）。放宽成可选：
      // 缺省 → 跳过校验，builder 按 0 处理；显式给值时仍要 int 且 ≥ 0。
      // 注意 `optional` 不进 swagger（openapi 里 priority 仍是 required）——
      // 把 schema 也改honest 要重导 api-types/schema.d.ts，属 packages 范围，留给批次 4。
      validateOptions: { int: true, min: 0, optional: true },
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
      // **刻意不挂 nestedWhenPresent**（批次 1 的实测结论，改前先读）：
      // query 的基座是"实体 DTO 的 partial 派生"，它同时带着**必填**字段与**值域**约束，
      // 而过滤条件天然是逐字段可缺省的 —— 直接开嵌套校验会把 20 个 list 端点里的 9 个
      // 变成 400（实测：AppLogger 的 fileName/logType isNotEmpty、logAuth 的 type isEnum/each、
      // logOperate 的 operatedAt isDateString/each、setting 的 settingType、dictData 的 tagType、
      // deleted 的 deletedAt range… 见 apps/api/src/common/list-request-validation.spec.ts 的用例名）。
      // query 的 P0（500）由 pg-column-op 的「列类型 → 算子」分派兜住，不需要 DTO 校验；
      // 严格 400 随批次 4 的显式 filters 契约一起做（Lead 拍板 Q1 同此口径）。
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
      validateOptions: { required: false, nestedWhenPresent: true },
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
      validateOptions: { required: false, nestedWhenPresent: true },
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
