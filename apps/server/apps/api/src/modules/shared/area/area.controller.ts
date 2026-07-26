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
import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
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
  async getChildren(@Query('pcode') pcode: string) {
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
