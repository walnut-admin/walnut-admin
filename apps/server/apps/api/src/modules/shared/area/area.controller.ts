import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common'
import { ApiQuery, ApiTags } from '@nestjs/swagger'

import { WalnutAdminDecoratorQueryArray } from '@walnut-server/decorators/query'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminDecoratorHasPermission } from '@walnut-server/guards'
import { WalnutAdminPipeAreaPcode } from '@walnut-server/pipes'
import { SharedAreaService } from './area.service'
import { SharedAreaDTO } from './dto/area.dto'

const Permissions = {
  AREA_CHILDREN_LIST: 'app:shared:area:children:list',
  AREA_FEEDBACK_LIST: 'app:shared:area:feedback:list',
} as const

@Controller('shared/area')
@ApiTags('shared/area')
export class SharedAreaController {
  constructor(private readonly areaService: SharedAreaService) {}

  @Get('children')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.AREA_CHILDREN_LIST)
  @ApiWalnutOkResponse({
    description: 'lazy load cascader data with `pcode`',
    DTO: SharedAreaDTO,
  })
  async getChildren(
    // pcode 形态闸：行政区划码 varchar(12) / 顶层 '0' —— 白名单正则拦注入面（受控 40099）
    @Query('pcode', new WalnutAdminPipeAreaPcode()) pcode: string,
  ) {
    return this.areaService.getChildrenByPcodeWithCache(pcode)
  }

  @Get('feedback')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.AREA_FEEDBACK_LIST)
  @ApiQuery({
    name: 'codes',
    type: String,
    required: true,
    description: `feedback area codes`,
  })
  @ApiWalnutOkResponse({
    description: 'feedback with whole area tree',
    DTO: SharedAreaDTO,
  })
  async feedback(
    @WalnutAdminDecoratorQueryArray({ fieldName: 'codes' })
    codes: string[],
  ) {
    return this.areaService.feedbackMultiple(codes)
  }
}
