import type { SchemaObject } from '@nestjs/swagger'
import { Solution } from '@cap.js/server'
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminDecoratorFreeResponse, WalnutAdminDecoratorThrottle, WalnutAdminGuardCapFree, WalnutAdminGuardDeviceFree, WalnutAdminGuardLockFree, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { SecurityCapService, SecurityCapSettingService } from '@walnut-server/security'
import { SecurityRoutes } from '@walnut/contract'

/**
 * F-18（DOC-07）：cap 两端点是 @WalnutAdminDecoratorFreeResponse() —— 响应**不套**
 * 项目统一壳 { code, msg, data }，body 就是 cap.js 的原生对象。所以这里用裸 schema
 * （不能用 ApiWalnutOkResponse：那是壳的形状），形状对齐 @cap.js/server 的
 * createChallenge / redeemChallenge 返回类型。
 */

/** POST /security/cap/challenge —— Cap.createChallenge 的返回（challenge / token / expires） */
const CAP_CHALLENGE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['challenge', 'token', 'expires'],
  properties: {
    challenge: {
      type: 'object',
      required: ['c', 's', 'd'],
      description: 'proof-of-work parameters: c = challenge count, s = challenge size (bytes), d = difficulty',
      properties: {
        c: { type: 'number' },
        s: { type: 'number' },
        d: { type: 'number' },
      },
    },
    token: {
      type: 'string',
      description: 'challenge token; echo it back in the redeem body together with the solutions',
    },
    expires: {
      type: 'number',
      description: 'challenge expiration timestamp (ms)',
    },
  },
}

/** POST /security/cap/redeem —— Cap.redeemChallenge 的返回（成功时带 token / expires） */
const CAP_REDEEM_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['success'],
  properties: {
    success: {
      type: 'boolean',
      description: 'whether the submitted solutions were accepted',
    },
    message: {
      type: 'string',
      description: 'failure reason, only present when success is false',
    },
    token: {
      type: 'string',
      description: 'redeemed token; also set as the CAPJS_TOKEN cookie (maxAge = cap ttl)',
    },
    expires: {
      type: 'number',
      description: 'token expiration timestamp (ms)',
    },
  },
}

@Controller(SecurityRoutes.CAP)
@ApiTags('security/cap')
@WalnutAdminGuardCapFree()
@WalnutAdminGuardJwtFree()
@WalnutAdminGuardDeviceFree()
@WalnutAdminGuardLockFree()
@WalnutAdminDecoratorThrottle(SecurityCapSettingService)
export class SecurityCapController {
  constructor(
    private readonly capService: SecurityCapService,
  ) { }

  @Post('/challenge')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  @ApiOkResponse({
    description: 'create a cap.js proof-of-work challenge (raw cap.js body, no response shell on this endpoint)',
    schema: CAP_CHALLENGE_SCHEMA,
  })
  // 4A：13 个缺 summary 的 op 之一（原先只有 ApiOkResponse 的 response description，
  // OpenAPI 的 operation summary 一直是空的 —— 侧边栏/列表里因此没有标题）。
  @ApiOperation({
    summary: 'Create a cap.js proof-of-work challenge',
  })
  @WalnutAdminDecoratorFreeResponse()
  async getChallenge() {
    return this.capService.challenge()
  }

  @Post('/redeem')
  @HttpCode(HttpStatus.OK)
  @WalnutAdminGuardSignFree()
  @ApiOkResponse({
    description: 'redeem a cap.js challenge solution for a token (raw cap.js body, no response shell on this endpoint; the token is also set as the CAPJS_TOKEN cookie)',
    schema: CAP_REDEEM_SCHEMA,
  })
  @ApiOperation({
    summary: 'Redeem a cap.js challenge solution for a token',
  })
  @WalnutAdminDecoratorFreeResponse()
  async getRedeem(@Req() req: IWalnutAdminExpressRequest, @Body() body: Solution) {
    return this.capService.redeem(body, req)
  }
}
