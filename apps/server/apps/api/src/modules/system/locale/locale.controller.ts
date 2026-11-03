import type { SchemaObject } from '@nestjs/swagger'
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
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminConstDecoratorLogOperateTitle } from '@walnut-server/const/decorator/logOperate'
import { WalnutCrudDecorators } from '@walnut-server/crud'

import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { WalnutAdminDecoratorParamArray } from '@walnut-server/decorators/params'
import { WalnutAdminSwaggerResponseSuccessSchemeData } from '@walnut-server/decorators/swagger'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'

import { WalnutAdminDecoratorHasPermission, WalnutAdminDecoratorUser, WalnutAdminGuardCapFree, WalnutAdminGuardDeviceFree, WalnutAdminGuardLockFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'

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
import { Locale, LocaleType, SystemRoutes } from '@walnut/contract'
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
 * F-19（DOC-11）：create / update 的 wire body 是「翻译映射」，不是 DTO 数组 ——
 *
 *   { key: string, oldKey?: string, [langId(uuid)]: 翻译值 }
 *
 * 自定义参数装饰器 TransformedLocaleBody() 反射不出类型，所以此前两个写端点在 openapi 里
 * 连 requestBody 都没有。这里按映射形状显式声明：固定键 key / oldKey 走 properties，其余
 * 「语言 id -> 译文」走 additionalProperties（JSON Schema 里 additionalProperties 只作用于
 * properties 未声明的键，正好是这批 uuid 键）。服务端会把它转换成 SysLocaleDTOCreateRequest[]
 * 再逐条严格校验 —— 见本文件 TransformedLocaleBody 的三段管道注释（DESIGN-ISSUES P2-10）。
 */
const LOCALE_MAPPING_BODY_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', description: 'locale key (message key, e.g. menu.title)' },
    oldKey: { type: 'string', description: 'previous key; needed only when renaming (update)' },
  },
  additionalProperties: {
    type: 'string',
    description: 'translation value, keyed by the language id (uuid) the translation belongs to',
  },
  example: {
    'key': 'menu.title',
    'oldKey': 'menu.oldTitle',
    '3f1c9b7e-6a24-4c8e-9d1b-2a7f5e0c4d13': '标题',
  },
}

/** F-20（DOC-05）：GET /system/locale/message/{locale} 的 data 是「消息 key -> 译文」映射 */
const LOCALE_MESSAGE_DATA_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: { type: 'string', nullable: true },
}

/**
 * B2 迁移模板（controller 层）：事务句柄 `ctx.dbSession` → `ctx.em`（已迁侧取 em）；
 * `.toObject()` 移除（PG 实体即 POJO），统一 plainToInstance(DTO, entity)。
 */
@Controller(SystemRoutes.LOCALE)
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
  // 批次 8 / B3（2026-11）：撤掉 @WalnutAdminGuardIpFree() —— 判据见报告：匿名语言包
  // **不需要**在 IP 黑名单之外。① 内容全是公开静态文案（仓库里就有），拒绝不损失任何
  // 机密性；② 同族的匿名引导端点 `lang/list/public` / `setting/public` 都是 IP 强制、
  // 上线至今正常；③ IP 黑名单**没有中间件兜底**，每个 IpFree 都是真实缺口。唯一代价：
  // 被拉黑 IP 的错误页失去译文（仍能拿到 40603 业务码），属既有「拉黑即全站拒绝」语义。
  // F-20（DOC-05 / DOC-14）：locale 是 union 字面量（emitDecoratorMetadata 反射成 Object），
  // swagger 只自动文档化反射型为 String/Number/Boolean 的参数 —— 路径参数因此在 openapi 里
  // 整个缺失；cache 带 DefaultValuePipe(1)，Nest 仍一律标 required: true。两处都按实现显式声明。
  @ApiParam({
    name: 'locale',
    required: true,
    description: 'language code; a value outside the enum falls back to en_US in the service',
    enum: Locale,
  })
  @ApiQuery({
    name: 'cache',
    required: false,
    type: Number,
    description: '1 = use the cached message map when present, 0 = rebuild it from the database (default 1)',
  })
  @ApiOkResponse({
    description: 'locale message map of the language: message key -> translated value',
    schema: WalnutAdminSwaggerResponseSuccessSchemeData(LOCALE_MESSAGE_DATA_SCHEMA),
  })
  // 4A：13 个缺 summary 的 op 之一。
  @ApiOperation({
    summary: 'Get the message map of a language',
  })
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
  @ApiBody({
    description: 'locale translation mapping: fixed key (+ optional oldKey) plus one property per language id (uuid) holding the translated value. The server converts it to SysLocaleDTOCreateRequest[] and validates every entry with that DTO.',
    schema: LOCALE_MAPPING_BODY_SCHEMA,
  })
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
  @ApiBody({
    description: 'locale translation mapping (same wire shape as create; key = the current key, oldKey = the key before renaming). The server converts it to SysLocaleDTOCreateRequest[] and validates every entry with that DTO.',
    schema: LOCALE_MAPPING_BODY_SCHEMA,
  })
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
