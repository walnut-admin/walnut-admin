import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { Role } from '@walnut/contract'
import { WalnutAdminDecoratorList } from '@/decorators/crud/list'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorHasRole } from '@/decorators/walnut/hasRole.decorator'
import { AppLoggerDTO, AppLoggerDTOListRequest, AppLoggerDTOListResponse, AppLoggerLogTypeType } from './dto/logger.dto'
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
    @Param('logType') logType: AppLoggerLogTypeType,
    @Param('fileName') fileName: string,
    @Query('page', new ParseIntPipe({ optional: true }), new DefaultValuePipe(1)) page: number,
  ) {
    return this.appLoggerService.read(`${logType}/${fileName}`, page)
  }
}
