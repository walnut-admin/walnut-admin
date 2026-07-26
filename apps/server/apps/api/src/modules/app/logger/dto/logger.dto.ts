import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'
import { TransformSizeToKB } from '@walnut/decorators/transformer'
import { RealPartialType, RealPickType } from '@walnut/utils/dto'
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
