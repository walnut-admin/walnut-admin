import { Buffer } from 'node:buffer'
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstDecoratorEncryptMetadataKey } from '@walnut-server/const/decorator/encrypt'

import { WalnutAdminExceptionRsaDecryptFailed } from '@walnut-server/exceptions/business/rsa'
import { SecurityRsaService } from '@walnut-server/rsa'
import { Recordable } from 'easy-fns-ts'
import { isNil } from 'lodash'
import { Observable, throwError } from 'rxjs'
import { catchError, tap } from 'rxjs/operators'

/**
 * 请求体信封解密（Q10 最后一公里，L1 2026-11-27）。
 *
 * ### 与 admin 侧 `_autoEncryptRequestData` 的 wire 契约
 * 客户端把字段值替换为：`base64( JSON{ enc:'AES_256_GCM', key, iv, ct, tag } )`，
 * 其中 `key = RSA-OAEP-SHA256(serverRsaPubKey, aesKey)`（32 字节 AES-256 密钥）、
 * `iv` 12 字节、`tag` 16 字节。服务端在本拦截器里用 app key 的 RSA 私钥解出 AES key，
 * 再 AES-GCM 解出明文 —— 与 `SecurityRsaService.decryptRequestValueWIthServerRsaPrivKey`
 * 逐字节互逆（该服务是 `rsa.service.ts` 里唯一的请求解密入口）。
 *
 * ### 明文必须真的替换 `request.body`
 * 旧实现只把结果写到 `request._decryptedBody`（配 `@WalnutAdminDecoratorBody` 用），
 * `@Body()` + 全局 ValidationPipe 拿到的仍是密文 → 校验必炸、业务字段恒空。现在同时：
 * 1. `request.body = 解密后的对象`（**真源**：`@Body()`、ValidationPipe、Sign 之后的读腿都看它）；
 * 2. `request._decryptedBody = 同一个对象`（`@WalnutAdminDecoratorBody` 的兼容通道）。
 *
 * ### 兼容：非信封值原样透传
 * 锁定与非锁定客户端可能同时存在（灰度期 / E2E 直连 / 存量 api-spec），所以**只解信封**：
 * 值不是合法信封时不做任何事（DTO 校验照常）。字段级严格模式（拒绝明文）留作后续硬化项 ——
 * 一旦服务端单方面强制，未启用 `_autoEncryptRequestData` 的客户端会拿到 40011 且无法自愈。
 *
 * ### 错误路径
 * 信封可识别但解不开（RSA 私钥轮换 / 客户端缓存了旧公钥 / 密文损坏）⇒ **40011**
 * （`BAD_REQUEST_DECRYPT_FAILED`）。admin 侧的 40011 自愈协议保持原样：清掉本地缓存的
 * 服务端公钥 → 重新拉取 → 重放原请求（`request/interceptor.ts` 的 `_encrypted=false`
 * 让重放重新加密）。非信封值不触发该协议。
 */
@Injectable()
export class WalnutAdminInterceptorRequestDecrypt implements NestInterceptor {
  private readonly logger = new Logger(WalnutAdminInterceptorRequestDecrypt.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly securityRsaService: SecurityRsaService,
  ) {}

  /**
   * 值是否是 admin `encryptRequestValue` 产出的 AES-GCM 信封（形状判定，不做解密）。
   * 公开 static 方便单测与其它消费者复用同一判据。
   */
  static isCipherEnvelope(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0) {
      return false
    }

    try {
      const payload = JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as Recordable | null
      return (
        payload !== null &&
        typeof payload === 'object' &&
        payload.enc === 'AES_256_GCM' &&
        typeof payload.key === 'string' &&
        payload.key.length > 0 &&
        typeof payload.iv === 'string' &&
        payload.iv.length > 0 &&
        typeof payload.ct === 'string' &&
        typeof payload.tag === 'string' &&
        payload.tag.length > 0
      )
    } catch {
      return false
    }
  }

  private async decryptRequest<T>(
    request: IWalnutAdminExpressRequest,
    data: T extends Recordable ? T : any,
    fields: keyof T | (keyof T)[],
  ): Promise<T> {
    // F-44：噪声过滤，**不是安全边界** —— isPostman 已被 isDev 门住（生产恒 false），权威说明见 apps/api/src/middleware/src/user-agent.middleware.ts 的 isPostmanRuntimeRequest。
    if (request.isPostman) {
      this.logger.debug(`Skipping decryption for Postman request`)
      return data
    }

    if (isNil(fields) || (Array.isArray(fields) && fields.length === 0)) {
      this.logger.debug(`No decrypt fields specified, skipping decryption`)
      return data
    }

    if (isNil(data) || typeof data !== 'object') {
      this.logger.debug(`Request body is empty / not an object, skipping decryption`)
      return data
    }

    const fieldsArray = (Array.isArray(fields) ? fields : [fields]) as string[]
    this.logger.log(`Decrypting request fields: ${fieldsArray.join(', ')}`)

    // 用 unknown 取值再逐字段收窄 —— Recordable 的索引是 any，会带出 no-unsafe-assignment
    const source = data as Record<string, unknown>
    const decryptedBody: Record<string, unknown> = { ...source }
    let decryptedCount = 0

    try {
      for (const key of fieldsArray) {
        const raw = source[key]

        // 非信封值原样保留（兼容未启用信封的客户端，见文件头）
        if (!WalnutAdminInterceptorRequestDecrypt.isCipherEnvelope(raw)) {
          this.logger.debug(`Field ${key} is not a cipher envelope, passed through`)
          continue
        }

        decryptedBody[key] =
          await this.securityRsaService.decryptRequestValueWIthServerRsaPrivKey(raw)
        decryptedCount += 1
        this.logger.debug(`Decrypted field: ${key}`)
      }

      this.logger.log(`Successfully decrypted ${decryptedCount}/${fieldsArray.length} fields`)
      return decryptedBody as T
    } catch (error) {
      this.logger.error(`Failed to decrypt request fields`, error)

      // 所有信封解密失败都收敛到 40011（客户端可自愈），不把底层原因（明文 / 栈）回给客户端
      if (error instanceof WalnutAdminExceptionRsaDecryptFailed) {
        throw error
      }

      throw new WalnutAdminExceptionRsaDecryptFailed()
    }
  }

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<string>> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    const decryptFields = this.reflector.getAllAndOverride<string | string[] | undefined>(
      WalnutAdminConstDecoratorEncryptMetadataKey.REQ_DECRYPT,
      [context.getHandler(), context.getClass()],
    )

    this.logger.debug(
      `Request decryption interceptor triggered for ${request.method} ${request.url}`,
    )

    try {
      const decryptedBody = await this.decryptRequest<Recordable>(
        request,
        request.body as Recordable,
        decryptFields ?? [],
      )

      // 真的换掉 body：@Body() + ValidationPipe 从这里取（旧实现只写 _decryptedBody，
      // 校验拿到的仍是密文 —— 这就是「信封最后一公里」断在哪里的原因）
      request.body = decryptedBody
      request._decryptedBody = decryptedBody

      this.logger.debug(`Request body decryption completed`)
    } catch (error) {
      this.logger.error(`Request decryption failed, terminating request`, error)
      throw error
    }

    // request keep going
    return next.handle().pipe(
      tap(() => {
        this.logger.debug(`Request processing completed`)
      }),
      catchError((error) => {
        this.logger.error(`Error occurred after decryption: ${error}`, error)
        return throwError(() => error as Error)
      }),
    )
  }
}
