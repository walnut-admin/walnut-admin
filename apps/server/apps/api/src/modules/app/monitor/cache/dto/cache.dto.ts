import { IWalnutAdminConstAppCacheType, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import {
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { RealPartialType } from '@walnut-server/utils/dto'
import { Dayjs } from 'dayjs'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'

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
