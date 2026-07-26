import type { ExecutionContext } from '@nestjs/common'
import { applyDecorators, createParamDecorator, SetMetadata, UseInterceptors } from '@nestjs/common'
import { WalnutAdminConstDecoratorEncryptMetadataKey } from '@walnut/const/decorator/encrypt'
import { WalnutAdminInterceptorRequestDecrypt } from '@/interceptors/request/decrypt.interceptor'
import { WalnutAdminInterceptorResponseEncrypt } from '@/interceptors/response/encrypt.interceptor'

/**
 * @description AES encrypt response data
 */
export function WalnutAdminDecoratorEncryptResponse<T>(fields?: keyof T | (keyof T)[]) {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorEncryptMetadataKey.RES_ENCRYPT, fields),
    UseInterceptors(WalnutAdminInterceptorResponseEncrypt),
  )
}

/**
 * @description AES decrypt request data
 */
export function WalnutAdminDecoratorDecryptRequest<T>(fields?: keyof T | (keyof T)[]) {
  return applyDecorators(
    SetMetadata(WalnutAdminConstDecoratorEncryptMetadataKey.REQ_DECRYPT, fields),
    UseInterceptors(WalnutAdminInterceptorRequestDecrypt),
  )
}

/**
 * @description Decrypted aes request body
 */
export const WalnutAdminDecoratorBody = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): any => {
    const request = ctx.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    return request._decryptedBody
  },
)
