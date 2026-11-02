import { ApiProperty } from '@nestjs/swagger'
import { IWalnutAdminConstAppCacheType, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import {
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealPartialType } from '@walnut-server/utils/dto'
import { Dayjs } from 'dayjs'

export class AppMonitorCacheDTO {
  constructor(partial: Partial<AppMonitorCacheDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'cache key',
    },
  })
  key: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'cache value bytes',
    },
  })
  valueBytes: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'cache expire seconds',
    },
  })
  expire: number

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppCacheType, {
    swaggerOptions: {
      title: 'cache type',
    },
  })
  type: IWalnutAdminConstAppCacheType

  @WalnutAdminDecoratorFieldDate({})
  startTime: Dayjs

  @WalnutAdminDecoratorFieldDate({})
  expireTime: Dayjs | null
}

// list
// L2 sort 白名单：Redis 缓存监控是内存列表（cache.service.list 的 lodash orderBy），
// 无 filesort 之虞，白名单对齐 admin 实际可排的五列（views/app/monitor/cache）；
// type 无 sorter 不收
export class AppMonitorCacheDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(AppMonitorCacheDTO),
  { sortOnlyIn: ['key', 'valueBytes', 'expire', 'startTime', 'expireTime'] },
) {}

export class AppMonitorCacheDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(AppMonitorCacheDTO),
) {}

/**
 * `GET /app/monitor/cache/{key}` 响应（P3-14）—— cache.controller.read 手工组装的
 * `{ value }`，与 list 行（AppMonitorCacheDTO）不同形。value 是 Redis 里 JSON.parse
 * 出来的原值（string / number / boolean / object / array 皆可），缺失键为 null；
 * swagger 只能声明「有一个任意 JSON 的 value 键」，生成侧为 unknown。
 * 仅文档化，wire 不变。
 */
export class AppMonitorCacheReadResponseDTO {
  // 任意 JSON：oneOf 显式列出标量/对象/数组（只写 type: Object 会把 string/number
  // 等缓存值误标成对象；nullable 覆盖缺失键/JSON null）
  @ApiProperty({
    title: 'cache value',
    description: 'cached value (raw JSON payload); null when the key is missing',
    nullable: true,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
    ],
  })
  value: unknown
}
