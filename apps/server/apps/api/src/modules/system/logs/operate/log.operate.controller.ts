import { Body, Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common'
import { ApiParam, ApiTags } from '@nestjs/swagger'

import { JwtAccessGuard } from '@walnut-server/auth'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutCrudDecorators } from '@walnut-server/crud'
import {
  WalnutAdminDecoratorParamUuid,
} from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorHasPermission } from '@walnut-server/guards'
import { assembleSysDevice, SysDeviceDTOReadResponse, SysLogOperateDTO, SysLogOperateDTOListRequest, SysLogOperateDTOListResponse, SysLogOperateDTOReadResponse, SysLogOperateDTOSnapshotResponse, SysLogOperateService } from '@walnut-server/system'
import { plainToInstance } from 'class-transformer'

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

/**
 * B8 迁移（controller 层，B1 模板）：路由参数 ParamMongoId → uuid 参数装饰器；
 * `.toObject()` 移除（PG 实体即 POJO），响应组装统一 `plainToInstance(DTO, entity)`；
 * 设备行经 assembleSysDevice 组装回 Mongo 版嵌套形态（sr/vp/geoLocation 拍平列还原，
 * B6 device read 同款）。
 */
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
  async getDevice(@WalnutAdminDecoratorParamUuid() id: string) {
    const device = await this.logOperateService.getDeviceByLogOperateId(id)

    return plainToInstance(
      SysDeviceDTOReadResponse,
      device ? assembleSysDevice(device) : null,
    )
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
  async getSnapshot(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(
      SysLogOperateDTOSnapshotResponse,
      await this.logOperateService.getSnapshot(id),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(
      SysLogOperateDTOReadResponse,
      await this.logOperateService.read(id),
    )
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: SysLogOperateDTOListRequest) {
    return plainToInstance(
      SysLogOperateDTOListResponse,
      await this.logOperateService.list(payload),
    )
  }
}
