import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { TransformSizeToKB } from '@walnut-server/decorators/transformer'
import { CreateWalnutAdminRequestListDTO, CreateWalnutAdminResponseListDTO } from '@walnut-server/list'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { ValueOf } from 'easy-fns-ts'

export const AppLoggerLogType = {
  APPLICATION: 'application',
  ERROR: 'error',
} as const

export type AppLoggerLogTypeType = ValueOf<typeof AppLoggerLogType>

/**
 * 日志文件行（list 响应面）。
 *
 * 批 6-A：5 个字段原先都是「`?` + `@IsOptional()`」双真源形态。它们由
 * `AppLoggerService.list` 逐条从 `fs.stat` 组装、5 个键恒有值（`compact` 只滤掉
 * stat 失败的整行），故去掉 `?` 与 `@IsOptional()`；`fileName` / `logType` 同时是
 * list 查询过滤键（`AppLoggerDTOListRequest` 的 RealPickType），而 query 信封不挂
 * ValidateNested（list.dto.ts 的 `validateOptions: { required: false }` → Allow），
 * 所以摘掉 IsOptional 对入参校验零影响。swagger 面不动 → openapi.json 零 diff。
 */
export class AppLoggerDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'log file name',
    },
  })
  fileName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'log file path',
    },
  })
  filePath: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'log file size KB',
    },
  })
  @TransformSizeToKB()
  fileSize: number

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'log file modify time',
    },
  })
  fileMTime: Date

  @WalnutAdminDecoratorFieldEnum(() => AppLoggerLogType, {
    swaggerOptions: {
      title: 'log file type',
    },
  })
  logType: AppLoggerLogTypeType
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
