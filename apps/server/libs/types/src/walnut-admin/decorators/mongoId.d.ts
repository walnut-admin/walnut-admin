import type { ClassConstructor } from 'class-transformer'

declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorMongoIdOptions {
    validate?: ClassConstructor<any>
    nullable?: boolean
  }

  type IWADVMIdOpt = IWalnutAdminDecoratorValidatorMongoIdOptions

  // transform
  interface IWalnutAdminDecoratorTransformerMongoIdRequestOptions {
    toObjectId?: boolean
  }

  type IWADTMIdReqOpt = IWalnutAdminDecoratorTransformerMongoIdRequestOptions

  interface IWalnutAdminDecoratorTransformerMongoIdResponseOptions {
    toString?: boolean
  }

  type IWADTMIdResOpt = IWalnutAdminDecoratorTransformerMongoIdResponseOptions

  interface IWalnutAdminDecoratorTransformMongoIdOptions
    extends IWalnutAdminDecoratorTransformOptions<
      IWalnutAdminDecoratorTransformerMongoIdRequestOptions,
      IWalnutAdminDecoratorTransformerMongoIdResponseOptions
    > {}

  type IWADTMIdOpt = IWalnutAdminDecoratorTransformMongoIdOptions

  // field option
  interface IWalnutAdminDecoratorFieldMongoIdOptions
    extends IWalnutAdminDecoratorBasicOptions<
      IWalnutAdminDecoratorValidatorMongoIdOptions,
      IWalnutAdminDecoratorTransformMongoIdOptions
    > {}

  type IWADMIdOpt = IWalnutAdminDecoratorFieldMongoIdOptions
}

export {}
