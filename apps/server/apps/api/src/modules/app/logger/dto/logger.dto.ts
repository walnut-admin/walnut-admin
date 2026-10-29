import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { TransformSizeToKB } from '@walnut-server/decorators/transformer'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { IsOptional } from 'class-validator'
import { ValueOf } from 'easy-fns-ts'
import { CreateWalnutAdminRequestListDTO, CreateWalnutAdminResponseListDTO } from '@/common/dto/list.dto'

export const AppLoggerLogType = {
  APPLICATION: 'application',
  ERROR: 'error',
} as const

export type AppLoggerLogTypeType = ValueOf<typeof AppLoggerLogType>

export class AppLoggerDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'log file name',
    },
  })
  @IsOptional()
  fileName?: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'log file path',
    },
  })
  @IsOptional()
  filePath?: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'log file size KB',
    },
  })
  @TransformSizeToKB()
  @IsOptional()
  fileSize?: number

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'log file modify time',
    },
  })
  @IsOptional()
  fileMTime?: Date

  @WalnutAdminDecoratorFieldEnum(() => AppLoggerLogType, {
    swaggerOptions: {
      title: 'log file type',
    },
  })
  @IsOptional()
  logType?: AppLoggerLogTypeType
}

// list
export class AppLoggerDTOListRequest extends CreateWalnutAdminRequestListDTO(RealPickType(AppLoggerDTO, ['fileName', 'logType'])) { }

export class AppLoggerDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(AppLoggerDTO),
) { }

/**
 * `GET /app/logger/:logType/:fileName?page=n` 响应 —— `AppLoggerService.read` 手工
 * 组装的形态（每次读 30 行），与 list 行（AppLoggerDTO）不同形。仅文档化，wire 不变。
 */
export class AppLoggerReadResponseDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'log file name',
    },
  })
  fileName: string

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'log lines of current page (30 lines per page)',
    },
  })
  fileContent: string[]

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'log file path relative to the logs folder',
    },
  })
  filePath: string
}
