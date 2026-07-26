import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstDecoratorEncryptMetadataKey } from '@walnut/const/decorator/encrypt'

import { Recordable } from 'easy-fns-ts'
import { isNil, omit } from 'lodash'
import { Observable, throwError } from 'rxjs'
import { catchError, tap } from 'rxjs/operators'
import { SecurityRsaService } from '@/modules/security/rsa/rsa.service'

@Injectable()
export class WalnutAdminInterceptorRequestDecrypt implements NestInterceptor {
  private readonly logger = new Logger(WalnutAdminInterceptorRequestDecrypt.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly securityRsaService: SecurityRsaService,
  ) { }

  private async decryptRequest<T>(
    request: IWalnutAdminExpressRequest,
    data: T extends Recordable ? T : any,
    fields: keyof T | (keyof T)[],
  ): Promise<T> {
    if (request.isPostman) {
      this.logger.debug(`Skipping decryption for Postman request`)
      return data
    }

    if (isNil(fields) || (Array.isArray(fields) && fields.length === 0)) {
      this.logger.debug(`No decrypt fields specified, skipping decryption`)
      return data
    }

    const fieldsArray = Array.isArray(fields) ? fields : [fields]
    this.logger.log(`Decrypting request fields: ${fieldsArray.join(', ')}`)

    try {
      if (Array.isArray(fields)) {
        const decryptedEntries = await Promise.all(
          fields.map(async (k) => {
            const decrypted = await this.securityRsaService.decryptRequestValueWIthServerRsaPrivKey(
              data[k],
            )
            this.logger.debug(`Decrypted field: ${String(k)}`)
            return [k, decrypted]
          }),
        )

        const decryptedObject = Object.fromEntries(decryptedEntries) as T
        this.logger.log(`Successfully decrypted ${fields.length} fields`)
        return Object.assign(omit(data, fields), decryptedObject)
      }

      const decryptedValue = await this.securityRsaService.decryptRequestValueWIthServerRsaPrivKey(
        data[fields],
      )
      this.logger.log(`Successfully decrypted field: ${String(fields)}`)
      return Object.assign(omit(data, fields), { [fields as string]: decryptedValue }) as T
    }
    catch (error) {
      this.logger.error(
        `Failed to decrypt request fields`,
        error,
      )
      throw error
    }
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<string>> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    const decryptFields: string[] = this.reflector.getAllAndOverride(
      WalnutAdminConstDecoratorEncryptMetadataKey.REQ_DECRYPT,
      [context.getHandler(), context.getClass()],
    )

    this.logger.debug(
      `Request decryption interceptor triggered for ${request.method} ${request.url}`,
    )

    try {
      // change the body to decrypted version
      request._decryptedBody = await this.decryptRequest(request, request.body, decryptFields) as Recordable
      this.logger.debug(`Request body decryption completed`)
    }
    catch (error) {
      this.logger.error(
        `Request decryption failed, terminating request`,
        error,
      )
      throw error
    }

    // request keep going
    return next.handle().pipe(
      tap(() => {
        this.logger.debug(`Request processing completed`)
      }),
      catchError((error) => {
        this.logger.error(
          `Error occurred after decryption: ${error}`,
          error,
        )
        return throwError(() => error as Error)
      }),
    )
  }
}
