import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'

import { WalnutAdminConstDecoratorEncryptMetadataKey } from '@walnut/const/decorator/encrypt'
import { Recordable } from 'easy-fns-ts'
import { isNil, omit } from 'lodash'
import { from, Observable } from 'rxjs'
import { switchMap, tap } from 'rxjs/operators'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { SecurityRsaService } from '@/modules/security/rsa/rsa.service'

@Injectable()
export class WalnutAdminInterceptorResponseEncrypt implements NestInterceptor {
  private readonly logger = new Logger(WalnutAdminInterceptorResponseEncrypt.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly securityRsaService: SecurityRsaService,
  ) { }

  private async cryptoResponse<T>(
    request: IWalnutAdminExpressRequest,
    data: T extends Recordable ? T : any,
    fields: keyof T | (keyof T)[],
  ) {
    if (request.isPostman) {
      this.logger.debug(`Skipping encryption for Postman request`)
      return data
    }

    if (isNil(fields) || (Array.isArray(fields) && fields.length === 0)) {
      this.logger.debug(`No encrypt fields specified, skipping encryption`)
      return data
    }

    // need to get from cookie
    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)
    const fieldsArray = Array.isArray(fields) ? fields : [fields]

    this.logger.log(`Encrypting response fields: ${fieldsArray.join(', ')} for device: ${deviceId?.substring(0, 8)}...`)

    try {
      if (Array.isArray(fields)) {
        const cryptedEntries = await Promise.all(
          fields.map(async (k) => {
            const encrypted = await this.securityRsaService.encryptResponseValueWithClientRsaPubKey(
              deviceId,
              data[k],
            )
            this.logger.debug(`Encrypted field: ${String(k)}`)
            return [k, encrypted]
          }),
        )

        const cryptedObject = Object.fromEntries(cryptedEntries) as T
        this.logger.log(`Successfully encrypted ${fields.length} fields`)
        return Object.assign(omit(data, fields), cryptedObject)
      }

      const cryptedValue = await this.securityRsaService.encryptResponseValueWithClientRsaPubKey(
        deviceId,
        data[fields],
      )
      this.logger.log(`Successfully encrypted field: ${String(fields)}`)
      return Object.assign(omit(data, fields), { [fields as string]: cryptedValue })
    }
    catch (error) {
      this.logger.error(
        `Failed to encrypt response fields`,
        error,
      )
      throw error
    }
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<Recordable>> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    const encryptFields: string[] = this.reflector.getAllAndOverride(
      WalnutAdminConstDecoratorEncryptMetadataKey.RES_ENCRYPT,
      [context.getHandler(), context.getClass()],
    )

    this.logger.debug(
      `Response encryption interceptor triggered for ${request.method} ${request.url}`,
    )

    return next.handle().pipe(
      switchMap((data: Recordable) => {
        this.logger.debug(`Processing response data for encryption`)
        return from(this.cryptoResponse(request, data, encryptFields))
      }),
      tap(() => {
        this.logger.debug(`Response encryption completed`)
      }),
    )
  }
}
