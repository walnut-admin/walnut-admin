import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { WalnutAdminPipeLogFileName, WalnutAdminPipeParamEnum } from '@walnut-server/pipes'
import { Role } from '@walnut/contract'
import { WalnutAdminDecoratorList } from '@/decorators/crud/list'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { AppLoggerDTO, AppLoggerDTOListRequest, AppLoggerDTOListResponse, AppLoggerLogType, AppLoggerLogTypeType } from './dto/logger.dto'
import { AppLoggerService } from './logger.service'

const Permissions = {
  LIST: 'app:logger:list',
  READ: 'app:logger:read',
} as const

@Controller('app/logger')
@ApiTags('app/logger')
@WalnutAdminDecoratorHasRole([Role.ADMIN, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)
export class AppLoggerController {
  constructor(private readonly appLoggerService: AppLoggerService) { }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList({
    swagger: { DTO: AppLoggerDTO },
    operateLog: { title: WalnutAdminConstDecoratorLogOperateTitle.APP_LOGGER },
  })
  async list(@Body() payload: AppLoggerDTOListRequest) {
    return new AppLoggerDTOListResponse(
      await this.appLoggerService.list(payload),
    )
  }

  @Get(':logType/:fileName')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  async readFile(
    // logType 枚举闸（application/error）+ fileName 白名单形态闸：双管道把
    // `..%2F..%2Fpackage.json` 类路径穿越 payload 拦在受控 40099（service 层另有
    // resolve 包含性断言兜底 —— 见 AppLoggerService.read）
    @Param('logType', new WalnutAdminPipeParamEnum(AppLoggerLogType)) logType: AppLoggerLogTypeType,
    @Param('fileName', new WalnutAdminPipeLogFileName()) fileName: string,
    @Query('page', new ParseIntPipe({ optional: true }), new DefaultValuePipe(1)) page: number,
  ) {
    return this.appLoggerService.read(`${logType}/${fileName}`, page)
  }
}
