import type { ApiPropertyOptions } from '@nestjs/swagger'

declare global {
  interface IWalnutAdminDecoratorArrayOptions {
    contains?: any[]
    notContains?: any[]
    maxSize?: number
    minSize?: number
    unique?: boolean
  }

  interface IWalnutAdminDecoratorTransformOptions<Q, S> {
    req?: Q
    res?: S
  }

  interface IWalnutAdminDecoratorBasicOptions<
    ValidateOptions,
    TransformOptions,
  > {
    default?: any
    isArray?: boolean
    arrayOptions?: IWalnutAdminDecoratorArrayOptions
    swaggerOptions?: ApiPropertyOptions
    validateOptions?: ValidateOptions
    transformOptions?: TransformOptions
  }
}

export {}
