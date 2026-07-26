import { Body, Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'

import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import {
  WalnutAdminDecoratorParamMongoId,
} from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutCrudDecorators } from '@/decorators/crud'
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { JwtAccessGuard } from '@/modules/auth/modules/jwt/jwt-access.guard'
import { SysDeviceDTOReadResponse } from '../../device/dto/device.dto'
import {
  SysLogOperateDTO,
  SysLogOperateDTOListRequest,
  SysLogOperateDTOListResponse,
  SysLogOperateDTOReadResponse,
  SysLogOperateDTOSnapshotResponse,
} from './dto/log.operate.dto'
import { SysLogOperateService } from './log.operate.service'

const Permissions = {
  READ: 'system:log:operate:read',
  LIST: 'system:log:operate:list',
  GET_SNAPSHOT: 'system:log:operate:getSnapshot',
  GET_DEVICE: 'system:log:operate:getDevice',
} as const

const { WalnutAdminDecoratorRead, WalnutAdminDecoratorList }
  = WalnutCrudDecorators({
    title: WalnutAdminConstDecoratorLogOperateTitle.LOG_OPERATE,
    DTO: SysLogOperateDTO,
    extra: {
      needOperateLog: false,
    },
  })

@Controller('system/log/operate')
@ApiTags('system/log/operate')
@UseGuards(JwtAccessGuard)
export class SysLogOperateController {
  constructor(private readonly logOperateService: SysLogOperateService) { }

  @Get(':id/device')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.GET_DEVICE], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Log Operate ID',
  })
  @ApiWalnutOkResponse({
    description: 'get log operate device',
    DTO: SysDeviceDTOReadResponse,
  })
  async getDevice(@WalnutAdminDecoratorParamMongoId() id: string) {
    const device = await this.logOperateService.getDeviceByLogOperateId(id)
    return new SysDeviceDTOReadResponse(device.toObject())
  }

  @Get(':id/snapshot')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission([Permissions.READ, Permissions.GET_SNAPSHOT], 'and')
  @ApiParam({
    name: 'id',
    type: String,
    required: true,
    description: 'Log Operate ID',
  })
  @ApiWalnutOkResponse({
    description: 'get log operate snapshot after & before',
    DTO: SysLogOperateDTOSnapshotResponse,
  })
  async getSnapshot(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysLogOperateDTOSnapshotResponse(
      (await this.logOperateService.getSnapshot(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamMongoId() id: string) {
    return new SysLogOperateDTOReadResponse(
      (await this.logOperateService.read(id)).toObject(),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysLogOperateDTOListRequest) {
    return new SysLogOperateDTOListResponse(
      await this.logOperateService.list(payload),
    )
  }
}
