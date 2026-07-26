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
export class AppMonitorCacheDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(AppMonitorCacheDTO),
) {}

export class AppMonitorCacheDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(AppMonitorCacheDTO),
) {}
