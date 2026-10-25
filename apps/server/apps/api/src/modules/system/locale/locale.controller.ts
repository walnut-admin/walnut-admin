import {
  Body,
  Controller,
  createParamDecorator,
  DefaultValuePipe,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseArrayPipe,
  ParseIntPipe,
  Query,
  ValidationPipe,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutDBSession, WalnutDBTransaction, WalnutTxContext } from '@walnut-server/db'
import { WalnutAdminDecoratorParamArray } from '@walnut-server/decorators/params'

import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { getAllConstraints } from '@walnut-server/utils/response'
import { LocaleType } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'
import { ValidationError } from 'class-validator'

import { WalnutCrudDecorators } from '@/decorators/crud'

import { WalnutAdminDecoratorHasPermission } from '@/decorators/walnut/hasPermission.decorator'
import { WalnutAdminDecoratorUser } from '@/decorators/walnut/user.decorator'
import { WalnutAdminGuardCapFree } from '@/guard/cap.guard'
import { WalnutAdminGuardDeviceFree } from '@/guard/device.guard'
import { WalnutAdminGuardIpFree } from '@/guard/ip.guard'
import { WalnutAdminGuardLockFree } from '@/guard/lock.guard'
import { WalnutAdminGuardSignFree } from '@/guard/sign.guard'
import { WalnutAdminGuardJwtFree } from '@/modules/auth/modules/jwt/jwt-access.guard'
import {
  SysLocaleDTO,
  SysLocaleDTOCreateRequest,
  SysLocaleDTOCreateResponse,
  SysLocaleDTODeleteResponse,
  SysLocaleDTOListRequest,
  SysLocaleDTOListResponse,
  SysLocaleDTOUpdateRequest,
  SysLocaleDTOUpdateResponse,
} from './dto/locale.dto'
import { LocalePayloadTransformPipe } from './locale.pipe'
import { SysLocaleService } from './locale.service'

const Permissions = {
  CREATE: 'system:locale:create',
  READ: 'system:locale:read',
  UPDATE: 'system:locale:update',
  DELETE: 'system:locale:delete',
  DELETE_MANY: 'system:locale:deleteMany',
  LIST: 'system:locale:list',
} as const

const {
  WalnutAdminDecoratorCreate,
  WalnutAdminDecoratorRead,
  WalnutAdminDecoratorUpdate,
  WalnutAdminDecoratorDelete,
  WalnutAdminDecoratorDeleteMany,
  WalnutAdminDecoratorList,
} = WalnutCrudDecorators({
  title: WalnutAdminConstDecoratorLogOperateTitle.LOCALE,
  DTO: SysLocaleDTO,
})

const RawBody = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): any => {
    const request: IWalnutAdminExpressRequest = ctx.switchToHttp().getRequest()
    return request.body
  },
)

// https://gist.github.com/josephdpurcell/9af97c36148673de596ecaa7e5eb6a0a
function TransformedLocaleBody() {
  return RawBody(
    // override global pipe
    new ValidationPipe({
      validateCustomDecorators: true,
      transform: true,
      whitelist: false,
      skipMissingProperties: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        exposeUnsetFields: true,
        excludeExtraneousValues: false,
      },
    }),
    // transform but no validate
    new LocalePayloadTransformPipe(),
    // validate the transformed data
    new ParseArrayPipe({
      items: SysLocaleDTOCreateRequest,
      exceptionFactory: (errors: ValidationError[]) =>
        new WalnutAdminExceptionRequestDataError(
          getAllConstraints(errors).join(','),
        ),
    }),
  )
}

/**
 * B2 迁移模板（controller 层）：事务句柄 `ctx.dbSession` → `ctx.em`（已迁侧取 em）；
 * `.toObject()` 移除（PG 实体即 POJO），统一 plainToInstance(DTO, entity)。
 */
@Controller('system/locale')
@ApiTags('system/locale')
export class SysLocaleController {
  constructor(private readonly localeService: SysLocaleService) { }

  @Get('/message/:locale')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardLockFree()
  @WalnutAdminGuardSignFree()
  @WalnutAdminGuardJwtFree()
  @WalnutAdminGuardCapFree()
  @WalnutAdminGuardDeviceFree()
  @WalnutAdminGuardIpFree()
  async getLocaleMessage(
    // NOTICE do not use WalnutAdminPipeParamEnum
    @Param('locale') locale: LocaleType,
    @Query('cache', new DefaultValuePipe(1), ParseIntPipe) cache: number,
  ) {
    return this.localeService.getLocaleMessage(locale, cache === 1)
  }

  @WalnutAdminDecoratorHasPermission(Permissions.CREATE)
  @WalnutAdminDecoratorCreate()
  @WalnutDBTransaction()
  async create(
    @WalnutDBSession() ctx: WalnutTxContext,
    @TransformedLocaleBody() payload: SysLocaleDTOCreateRequest[],
  ) {
    const res = await this.localeService.create(payload, ctx.em)
    return res.map(i => plainToInstance(SysLocaleDTOCreateResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.READ)
  @WalnutAdminDecoratorRead('key')
  async read(@Param('key') key: string) {
    return this.localeService.read(key)
  }

  @WalnutAdminDecoratorHasPermission(Permissions.UPDATE)
  @WalnutAdminDecoratorUpdate()
  @WalnutDBTransaction()
  async update(
    @WalnutDBSession() ctx: WalnutTxContext,
    @TransformedLocaleBody() payload: SysLocaleDTOUpdateRequest[],
  ) {
    const res = await this.localeService.update(payload, ctx.em)
    return res.map(i => plainToInstance(SysLocaleDTOUpdateResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete('key')
  @WalnutDBTransaction()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() ctx: WalnutTxContext,
    @Param('key') key: string,
  ) {
    const res = await this.localeService.deleteByKey(key, user.userId, ctx.em)
    return res.map(i => plainToInstance(SysLocaleDTODeleteResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE_MANY)
  @WalnutAdminDecoratorDeleteMany('keys')
  @WalnutDBTransaction()
  async deleteMany(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutDBSession() ctx: WalnutTxContext,
    @WalnutAdminDecoratorParamArray({ fieldName: 'keys' }) keys: string[],
  ) {
    const res = await this.localeService.deleteManyByKey(keys, user.userId, ctx.em)
    return res.map(i => plainToInstance(SysLocaleDTODeleteResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.LIST)
  @WalnutAdminDecoratorList()
  async list(@Body() params: SysLocaleDTOListRequest) {
    return plainToInstance(SysLocaleDTOListResponse, await this.localeService.list(params))
  }
}
