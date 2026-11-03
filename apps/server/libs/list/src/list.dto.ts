import type { FilterOp } from '@walnut/contract'

import {
  WalnutAdminDecoratorFieldAny,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'

import { WALNUT_LIST_PAGE_SIZE_MAX } from '@walnut-server/utils/list-page'
import { FilterOpValues, SortOrderValues } from '@walnut/contract'
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
   *
   * ## filters 为什么不在这里收敛 field 白名单（批次 4-A）
   *
   * 过滤面**不等于**实体 DTO 的属性面：`deleted` 的 `content`（jsonb 旁路）、
   * `monitor/user` 的 `ip/country/os/browser/userName`（JOIN 别名）、`device` 的
   * `location`（jsonb 三字段 OR）、`locale` 的 `value/langId`（文档级过滤）都落在
   * 实体 DTO 属性之外。用 DTO 属性当白名单会把这几条端点直接 400。
   * 收敛交给 SQL 层（`pg-list.builder` 只认实体元数据里的列）与各旁路自己的
   * MATCH 表（`locale.repo.service`），与批次 1 的口径一致。
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

  /**
   * 单条过滤条件 —— 批次 4-A 的 wire 形态（`{ field, op, value }`）。
   *
   * 三层校验分工（改这里之前先读）：
   * 1. **本 DTO**：`field` 非空字符串、`op` 必须是 `FilterOpValues` 之一；
   *    未声明键（`forbidNonWhitelisted`）与非法 op 在这里就 **400 / 40099**；
   * 2. **列类型裁决**（`pg-column-op` 的 `resolvePgFilterCondition`）：
   *    `like` 打非文本列、`range` 打非时间列、uuid 列收到非 uuid 串、布尔列收到
   *    "abc"、`in` 收到非数组…… 一律 **40099**，**不再降级成丢弃**；
   * 3. **列的可见面**（实体元数据的列白名单 / 各旁路自己的 MATCH 表）：非列字段仍然
   *    丢弃（与批次 1 的 `columns.has()` 同语义），因为过滤面本来就有 JOIN 别名键。
   */
  class FilterDTO {
    @WalnutAdminDecoratorFieldString({
      swaggerOptions: { title: 'filter field name', example: 'userName' },
    })
    readonly field: string

    @WalnutAdminDecoratorFieldEnum(() => FilterOpValues, {
      swaggerOptions: {
        title: 'filter operator, eq / like / in / range / isNull',
        example: 'like',
      },
    })
    readonly op: FilterOp

    // 形态由 op 决定（eq 标量 / like 字符串 / in 数组 / range 长度 2 数组 / isNull 不带值）：
    // 字段级校验表达不了"按另一个字段分叉"，放行后交列类型裁决（见类注释第 2 层）。
    @WalnutAdminDecoratorFieldAny({
      swaggerOptions: {
        title: 'filter value, shape depends on op',
        example: 'admin',
      },
    })
    readonly value: unknown
  }

  class ListDTO {
    constructor(partial?: Partial<T>) {
      Object.assign(this, partial)
    }

    @WalnutAdminDecoratorFieldObject(FilterDTO, {
      default: {},
      isArray: true,
      swaggerOptions: {
        example: [
          { field: 'userName', op: 'like', value: 'adm' },
          { field: 'createdAt', op: 'range', value: ['2024-01-01', '2024-12-31'] },
        ],
      },
      // 与 sort 槽位同口径：**可缺省 / 空数组都合法，给了就下钻校验**。
      // 这一格就是批次 4-A 的"非法 op 明确拒绝"入口 —— 批次 1 时 query 刻意没开
      // 嵌套校验（因为它的基座是实体 DTO 的 partial 派生，带着必填与值域约束，
      // 一开会把 9 个端点变 400）；filters 的基座是专用 FilterDTO，可以开。
      validateOptions: { required: false, nestedWhenPresent: true },
      transformOptions: {
        req: {
          defaultTransform: true,
        },
      },
    })
    readonly filters: FilterDTO[]

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
