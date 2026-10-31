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
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamArray } from '@walnut-server/decorators/params'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'

import { WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser, WalnutAdminGuardCapFree, WalnutAdminGuardDeviceFree, WalnutAdminGuardIpFree, WalnutAdminGuardLockFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'

import {
  LocalePayloadTransformPipe,
  SysLocaleDTO,
  SysLocaleDTOCreateRequest,
  SysLocaleDTOCreateResponse,
  SysLocaleDTODeleteResponse,
  SysLocaleDTOListRequest,
  SysLocaleDTOListResponse,
  SysLocaleDTOUpdateRequest,
  SysLocaleDTOUpdateResponse,
  SysLocaleService,
} from '@walnut-server/system'
import { getAllConstraints } from '@walnut-server/utils/response'
import { LocaleType } from '@walnut/contract'
import { plainToInstance } from 'class-transformer'
import { ValidationError } from 'class-validator'

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
//
// 【有意设计，已登记 DESIGN-ISSUES.md P2-10】这里的 ValidationPipe **必须**局部放宽
// 全局不变式（whitelist:false + skipMissingProperties:true），原因在本端点的 wire 形状：
// create/update 的 body 是「翻译映射」而非 DTO 形状 —— `{ key, oldKey?, <langId-uuid>: 翻译值 }`，
// 键名是运行时 lang uuid，永远不可能出现在静态 DTO 属性集里。全局 pipe 的
// whitelist + forbidNonWhitelisted 会把这些 uuid 键剥掉/拒掉，批量翻译一个都到不了 service。
// 校验并没有消失，而是**二段式后移**：① 本 pipe 只做 transform（保留 uuid 键、不按 DTO
// 必填校验原始映射）；② LocalePayloadTransformPipe 把 uuid 键映射成
// `[{ langId, key, value, oldKey }]` 数组；③ ParseArrayPipe 才对每个元素按
// SysLocaleDTOCreateRequest 严格校验。放宽只覆盖第一段，wire 契约仍由第三段钉死。
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
  @WalnutTx()
  async create(
    @WalnutTxSession() ctx: WalnutTxContext,
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
  @WalnutTx()
  async update(
    @WalnutTxSession() ctx: WalnutTxContext,
    @TransformedLocaleBody() payload: SysLocaleDTOUpdateRequest[],
  ) {
    const res = await this.localeService.update(payload, ctx.em)
    return res.map(i => plainToInstance(SysLocaleDTOUpdateResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE)
  @WalnutAdminDecoratorDelete('key')
  @WalnutTx()
  async delete(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Param('key') key: string,
  ) {
    const res = await this.localeService.deleteByKey(key, user.userId, ctx.em)
    return res.map(i => plainToInstance(SysLocaleDTODeleteResponse, i))
  }

  @WalnutAdminDecoratorHasPermission(Permissions.DELETE_MANY)
  @WalnutAdminDecoratorDeleteMany('keys')
  @WalnutTx()
  async deleteMany(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
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
