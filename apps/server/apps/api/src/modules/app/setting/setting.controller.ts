import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateTitle, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'

import { WalnutCrudDecorators } from '@walnut-server/crud'
import { WalnutAdminDecoratorParamUuid } from '@walnut-server/decorators/params'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'

import { plainToInstance } from 'class-transformer'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorOperateLog } from '@/decorators/walnut/log.operate.decorator'
import { WalnutAdminGuardCapFree } from '@/guard/cap.guard'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminGuardJwtFree } from '@/modules/auth/modules/jwt/jwt-access.guard'
import {
  AppSettingDTOCreateRequest,
  AppSettingDTOCreateResponse,
  AppSettingDTOListRequest,
  AppSettingDTOListResponse,
  AppSettingDTOPublicResponse,
  AppSettingDTOReadResponse,
  AppSettingDTOSafe,
  AppSettingDTOUpdateRequest,
  AppSettingDTOUpdateResponse,
} from './dto/setting.dto'
import { AppSettingRepositoryService } from './repo/setting.repo.service'
import { AppSettingService } from './setting.service'

const Permissions = {
  CREATE: 'app:setting:create',
  READ: 'app:setting:read',
  UPDATE: 'app:setting:update',
  LIST: 'app:setting:list',
  CACHE_REFRESH: 'app:setting:cache:refresh',
} as const

const { WalnutAdminDecoratorCreate, WalnutAdminDecoratorRead, WalnutAdminDecoratorUpdate, WalnutAdminDecoratorList }
  = WalnutCrudDecorators({
    title: WalnutAdminConstDecoratorLogOperateTitle.APP_SETTING,
    DTO: AppSettingDTOSafe,
  })

@Controller('app/setting')
@ApiTags('app/setting')
export class AppSettingController {
  constructor(
    private readonly settingService: AppSettingService,
    private readonly settingRepo: AppSettingRepositoryService,
  ) {}

  @Get('public')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  @WalnutAdminGuardDeviceFree()
  @ApiWalnutOkResponse({
    description: 'Get public app settings',
    DTO: AppSettingDTOPublicResponse,
  })
  async getPublicSettings() {
    const authSettings = await this.settingService.getAuthSettings()
    const frontendSettings = await this.settingService.getFrontendSettings()

    return new AppSettingDTOPublicResponse({
      auth: authSettings,
      frontend: frontendSettings,
    })
  }

  @Get('private')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  async getPrivateSettings() {
    return this.settingService.getPrivateSettings()
  }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  async create(@Body() payload: AppSettingDTOCreateRequest) {
    return plainToInstance(AppSettingDTOCreateResponse, await this.settingService.create(payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead()
  async read(@WalnutAdminDecoratorParamUuid() id: string) {
    return plainToInstance(AppSettingDTOReadResponse, await this.settingService.read(id))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  async update(
    @Body() payload: AppSettingDTOUpdateRequest,
    @WalnutAdminDecoratorParamUuid() id: string,
  ) {
    return plainToInstance(AppSettingDTOUpdateResponse, await this.settingService.update(id, payload))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() payload: AppSettingDTOListRequest) {
    return plainToInstance(AppSettingDTOListResponse, await this.settingService.list(payload))
  }

  @Post('cache/refresh')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminDecoratorHasPermission(Permissions.CACHE_REFRESH)
  @WalnutAdminDecoratorOperateLog({
    title: WalnutAdminConstDecoratorLogOperateTitle.APP_SETTING,
    action: WalnutAdminConstDecoratorLogOperateAction.REFRESH,
    operateType: WalnutAdminConstDecoratorLogOperateType.APP_SETTING_REFRESH_CACHE,
  })
  async refreshCache() {
    await this.settingRepo.extractAppSettingIntoCache()
    return true
  }
}
