import type { IWalnutAdminSseClientData, IWalnutAdminSseOAuthPayload } from '@walnut/contract/sse'
import {
  Controller,
  Get,
  Logger,
  Param,
  Render,
  Req,
  Request,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'

import { AuthCookieService, AuthSharedService, OAuthGiteeScope, OAuthStateService, WalnutAdminGuardJwtFree } from '@walnut-server/auth'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { IWalnutAdminConstAppSettingAuthOAuthGiteeKeys } from '@walnut-server/const/app/setting'
import { WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'
import { WalnutTx, WalnutTxContext, WalnutTxSession } from '@walnut-server/db'
import { ApiWalnutOkResponse } from '@walnut-server/decorators/swagger/response.decorator'
import { WalnutAdminExceptionDeviceNotAcceptable } from '@walnut-server/exceptions/base/406'
import { WalnutAdminDecoratorAuthLog, WalnutAdminDecoratorDataScopeSystemChannel, WalnutAdminDecoratorDeviceId, WalnutAdminDecoratorFunctionalGuard, WalnutAdminDecoratorUser, WalnutAdminGuardSignFree } from '@walnut-server/guards'
import { SysUserIdentitySharedService, WalnutAdminConstSysUserIdentityType } from '@walnut-server/identity'
import { SecurityRiskFailedLoginService } from '@walnut-server/security/risk/modules/failedLogin.service'
import { AppTechSseService } from '@walnut-server/sse'
import { AuthRoutes, LocaleType } from '@walnut/contract'
import { WalnutAdminSseEvents } from '@walnut/contract/sse'
import { I18n, I18nContext } from 'nestjs-i18n'
import { OAuthGiteeGuard } from './gitee.guard'

@Controller(AuthRoutes.OAUTH_GITEE)
@ApiTags('auth/oauth/gitee')
@WalnutAdminDecoratorFunctionalGuard<IWalnutAdminConstAppSettingAuthOAuthGiteeKeys>(WalnutAdminConstAppSettingKeys.APP_AUTH_GITEE, 'authEnable')
@WalnutAdminGuardJwtFree()
// 数据权限三期：登录链系统通道（匿名进入，按 oauth 绑定读写 sys_user）
@WalnutAdminDecoratorDataScopeSystemChannel()
export class OAuthGiteeController {
  private readonly logger = new Logger(OAuthGiteeController.name)

  constructor(
    private readonly configService: ConfigService,
    private readonly authSharedService: AuthSharedService,
    private readonly sseService: AppTechSseService,
    private readonly authCookieService: AuthCookieService,
    private readonly failedLoginRiskService: SecurityRiskFailedLoginService,
    private readonly userIdentitySharedService: SysUserIdentitySharedService,
    private readonly oauthStateService: OAuthStateService,
  ) { }

  private readonly oauthUrl = 'https://gitee.com/oauth/authorize'

  get clientId() {
    return this.configService.get<string>('auth.gitee.clientId')
  }

  get callbackURL() {
    return this.configService.get<string>('auth.gitee.callbackURL')
  }

  /**
   * F-04（2026-11-01）：投递频道键只由**服务端签名的 device cookie** 推导
   * （`oauth/gitee/device/<deviceId>`）。订阅侧与回调侧共用本方法 —— 两侧键同源。
   *
   * 修复前键是客户端指纹（`req.fingerprint` ← `X-Fingerprint` 请求头）经 state 回传的值：
   * 任何人自选 fp 抢注频道即可截胡随后投递的 accessToken + sessionKey（登录会话根密钥）。
   * deviceId 来自**服务端签发的签名 cookie**：形态 d1_ + 32 位小写 hex（判据唯一真源是
   * libs/const/src/app/device.ts 的 isValidDeviceId），B5 起由服务端 randomBytes(16) 随机签发，
   * 与客户端指纹**无关**；cookie 另带 cookie-parser 签名，改一个字符就解签失败。
   */
  private getSseClientId(deviceId: string): string {
    if (typeof deviceId !== 'string' || deviceId.length === 0) {
      // 第二道闸：DeviceGuard 已拒绝无设备 cookie 的请求（签名不匹配时 cookie-parser 会把
      // 该值置成 false）。这里防止 guard 链将来调整后键退化成 oauth/gitee/device/false ——
      // 那会让所有无设备请求共享同一个频道。
      throw new WalnutAdminExceptionDeviceNotAcceptable()
    }

    return `oauth/gitee/device/${deviceId}`
  }

  /**
   * P2-13（2026-10-28）：state = `base64url(JSON{lang,nonce}).HMAC-SHA256`，nonce
   * 与服务端会话密钥签名一并落 Redis（10 分钟 TTL），并且绑定发起请求的 deviceId。
   *
   * 批次6-B：签发入参不再带客户端指纹（fp 已全仓无消费方，见 OAuthStateService）。
   */
  private async getOAuthURL(lang: LocaleType, deviceId: string) {
    const state = await this.oauthStateService.issueState(lang, deviceId)
    return `${this.oauthUrl}?client_id=${this.clientId}&redirect_uri=${this.callbackURL
    }&response_type=code&scope=${OAuthGiteeScope.join('%20')}&state=${state}`
  }

  @Get('url')
  // F-18（DOC-07）：此前 200 无 schema（handler 返回拼好的授权 URL 串）。
  @ApiWalnutOkResponse({
    description: 'get the OAuth (gitee) authorize URL of this deployment (state is signed by the server and bound to the requesting device)',
    primitive: 'string',
  })
  async OAuth(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @Req() req: IWalnutAdminExpressRequest,
  ) {
    return this.getOAuthURL(req.language, deviceId)
  }

  @Get('callback')
  @WalnutAdminGuardSignFree()
  @WalnutTx()
  // F-18（DOC-07）+ DOC-15：callback 是浏览器跳转目标，响应是 @Render 出的 HTML 页而不是
  // JSON 业务壳（登录结果走同 controller 的 SSE 通道投递），文档按 text/html 声明。
  @ApiOkResponse({
    description: 'Browser redirect target of the OAuth provider. Renders an HTML result page (view: template/oauth/done) instead of the JSON business shell -- the login result (access token + session key, or a translated error message) is delivered out-of-band on the per-device SSE channel GET /auth/oauth/gitee/sse/{fp}.',
    content: {
      'text/html': {
        schema: { type: 'string', description: 'rendered HTML result page' },
      },
    },
  })
  // 4A：13 个缺 summary 的 op 之一。
  @ApiOperation({
    summary: 'OAuth (Gitee) callback result page',
  })
  @WalnutAdminDecoratorAuthLog(WalnutAdminConstDecoratorLogAuthType.OAUTH_GITEE)
  @Render('template/oauth/done')
  @UseGuards(OAuthGiteeGuard)
  // in order to make @Render work, we need to try/catch below
  // and do not use @UseFilters(OAuthExceptionFilter) like this
  async callback(
    @WalnutAdminDecoratorUser() user: IWalnutAdminAccessTokenPayload,
    @WalnutTxSession() ctx: WalnutTxContext,
    @Request() req: IWalnutAdminExpressRequest,
    @I18n() i18n: I18nContext,
  ) {
    // 批次6-B：lang 与 deviceId 都取自 guard 消费后的 state（req.oauthState）——
    // 不再二次解析 `state` query 的 base64url、也不回读 device cookie，于是「投递频道
    // 绑定的设备」与「state 签发时绑定的设备」是同一个值（guard 里已做相等校验，
    // 跨设备完成的 state 直接被拒）。
    // oauthState 缺失只可能来自 guard 链被改坏：deviceId 退化为空串后 getSseClientId
    // 会以 406 拒绝，绝不投递到未与 state 绑定的设备（fail-closed）。
    const lang = req.oauthState?.lang ?? (i18n.lang as LocaleType)
    const deviceId = req.oauthState?.deviceId ?? ''

    const sseClientId = this.getSseClientId(deviceId)

    try {
      // B7b 归一：refresh 写腿迁 PG —— 单 em（identity 写腿本就 ctx.em）
      const { accessToken, refreshTokenJti, authSessionKey } = await this.authSharedService.generateAuthTokens(user, deviceId, ctx.em)

      // Mark email identity as verified after successful OAuth validation
      await this.userIdentitySharedService.verifyIdentity(
        user.userId,
        WalnutAdminConstSysUserIdentityType.EMAIL_ADDRESS,
        'login',
        ctx.em,
      )

      // Set refresh token jti to cookie
      this.authCookieService.setRTJtiCookie(req, refreshTokenJti)

      const successPayload: IWalnutAdminSseClientData<IWalnutAdminSseOAuthPayload> = {
        success: true,
        message: 'success',
        data: {
          event: WalnutAdminSseEvents.OAUTH_GITEE,
          accessToken,
          sessionKey: authSessionKey,
        },
      }

      const delivered = this.sseService.sendToClient(sseClientId, successPayload)

      if (!delivered) {
        // 只记投递结果，不记载荷内容（accessToken + sessionKey 属凭据材料，F-06 口径）
        this.logger.warn(`oauth gitee callback succeeded but nobody is listening on the device channel`)
      }
    }
    catch (exception) {
      const errMsg = exception instanceof Error ? exception.message : 'business.auth.authFailed'
      const translatedMsg: string = i18n.t(errMsg, { lang })
      const errorPayload: IWalnutAdminSseClientData<Record<string, never>> = {
        success: false,
        message: translatedMsg,
        data: {},
      }

      // Record failed login risk
      // F-05：fire-and-forget 必须自带 catch —— Node 24 默认 --unhandled-rejections=throw，
      // 风控采集（Redis / 队列）抖动会把整个 API 进程带走。
      void this.failedLoginRiskService.collect({
        deviceId,
        identifier: req.identifier,
        ip: req.realIp,
        reason: translatedMsg,
        loginType: WalnutAdminConstDecoratorLogAuthType.OAUTH_GITEE,
      }).catch((error: unknown) => {
        this.logger.warn(`oauth gitee failed-login risk collect failed: ${error instanceof Error ? error.message : String(error)}`)
      })

      // F-06：不再打印 fingerprint 原文（客户端可控、可含换行 ⇒ 日志伪造面；也便于枚举设备），
      // 只留投递结果。
      const delivered = this.sseService.sendToClient(sseClientId, errorPayload)
      this.logger.warn(`oauth gitee callback failed: sse delivered=${delivered}`)
    }
  }

  /**
   * F-04（2026-11-01）：订阅者的频道键由**服务端签名 device cookie**（DEVICE_ID）推导，
   * URL 段不再参与任何键。历史 URL `sse/:fp` 保留只为前端兼容（apps/admin 仍拼接设备
   * 指纹），其值与投递频道、日志都无关。
   *
   * F-22：这是 text/event-stream 端点，不是普通 GET —— 每个 `data:` 帧是一个 JSON 编码的
   * `IWalnutAdminSseClientData<IWalnutAdminSseOAuthPayload>`（契约单一真源
   * packages/platform-any/contract/src/sse.ts）：成功帧 data 为
   * `{ event: 'token:gitee', accessToken, sessionKey }`，失败帧 data 为空对象、
   * message 为已翻译文案。
   */
  @WalnutAdminGuardSignFree()
  @ApiParam({
    name: 'fp',
    required: true,
    description: 'Legacy URL segment carrying the client fingerprint. Since F-04 it is NOT part of the SSE channel key (the key is derived from the signed device cookie) and is kept only for URL compatibility with the existing SPA.',
  })
  @ApiOperation({
    summary: 'OAuth (Gitee) login result stream',
    description: 'Server-Sent Events stream that delivers the OAuth login result to the browser which started the flow. The channel is bound to the signed device cookie (DEVICE_ID) of the requesting device, so only the originating device receives the payload. Each `data:` frame is a JSON encoded `IWalnutAdminSseClientData<IWalnutAdminSseOAuthPayload>` (see @walnut/contract/sse): a success frame carries `{ event: "token:gitee", accessToken, sessionKey }`, a failure frame carries an empty `data` object plus a translated `message`.',
  })
  @ApiResponse({
    status: 200,
    description: 'text/event-stream: each `data:` frame is a JSON encoded `IWalnutAdminSseClientData<IWalnutAdminSseOAuthPayload>`.',
    content: {
      'text/event-stream': {
        schema: {
          type: 'string',
          example: 'data: {"success":true,"message":"success","data":{"event":"token:gitee","accessToken":"<jwt>","sessionKey":"<base64 session key>"}}',
        },
      },
    },
  })
  // 4A：@Sse 不在顺序表里（未知档，排在最后）—— 顺序表收录 ApiOperation/ApiResponse 之后，
  // 它不能再夹在 @ApiParam 与 @ApiOperation 之间，否则 lint 会要求重排。
  @Sse('sse/:fp')
  async sse(
    @WalnutAdminDecoratorDeviceId() deviceId: string,
    @Res() res: IWalnutAdminExpressResponse,
    @Param('fp') _fp: string,
  ) {
    const sseClientId = this.getSseClientId(deviceId)
    const client = this.sseService.createClient(sseClientId)

    res.on('close', () => {
      // 按连接实例释放（F-04）：同设备的多标签页共享同一频道，先关的标签页不能终结别人的流
      client.close()
    })

    return this.sseService.getClientObservable(sseClientId)
  }
}
