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
 * stat 失败的整行），故去掉 `?` 与 `@IsOptional()`。
 *
 * **批次 1 · P0 之后（R3 订正过：这段原先写反了）**：list 的三个槽位里，
 * **只有 `sort` / `page` 开了** `nestedWhenPresent`，**`query` 刻意没开**
 * （理由见 `libs/list/src/list.dto.ts` 的 ListDTO 注释：query 基座带着必填字段与
 * 创建语义的值域约束，直接下钻会把 9 条现存请求打成 400）。
 *
 * 因此：
 * - `fileName` / `logType` 没有 `@IsOptional()` **不影响本端点的入参校验**（query 不下钻）；
 *   它们保持"恒有值"是因为响应面由 `AppLoggerService.list` 从 `fs.stat` 逐条组装。
 * - 真正生效的是 **sort 槽位**：`sort[].field` 的 `onlyIn` 白名单会拦 —— 所以下面
 *   `AppLoggerDTOListRequest` 必须显式给 `sortOnlyIn`（含 `fileMTime`）。
 * - swagger 面未动 → openapi.json 零 diff。
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
// sortOnlyIn 必填：`CreateWalnutAdminRequestListDTO` 缺省会用"query 基座的全部键"当白名单，
// 而这里基座是 `RealPickType(AppLoggerDTO, ['fileName','logType'])` —— `fileMTime` 不在里面，
// 打开 nestedWhenPresent 后 `sort:[{field:'fileMTime'}]` 会被 onlyIn 判 400（api-spec 在用）。
// 注意：`AppLoggerService.list` 目前**忽略** sort（恒按 fileMTime desc），白名单只是契约面。
export class AppLoggerDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPickType(AppLoggerDTO, ['fileName', 'logType']),
  { sortOnlyIn: ['fileName', 'logType', 'fileMTime'] },
) { }

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
