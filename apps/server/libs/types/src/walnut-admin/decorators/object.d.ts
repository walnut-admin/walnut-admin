declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorObjectOptions {
    required?: boolean
    any?: boolean
  }

  type IWADVObjOpt = IWalnutAdminDecoratorValidatorObjectOptions

  // transform
  interface IWalnutAdminDecoratorTransformerObjectRequestOptions {
    defaultTransform?: boolean
  }

  type IWADTObjReqOpt = IWalnutAdminDecoratorTransformerObjectRequestOptions

  interface IWalnutAdminDecoratorTransformerObjectResponseOptions {
    maskSensitive?: boolean
    defaultTransform?: boolean
  }

  type IWADTObjResOpt = IWalnutAdminDecoratorTransformerObjectResponseOptions

  interface IWalnutAdminDecoratorTransformObjectOptions
    extends IWalnutAdminDecoratorTransformOptions<
      IWalnutAdminDecoratorTransformerObjectRequestOptions,
      IWalnutAdminDecoratorTransformerObjectResponseOptions
    > {}

  type IWADTObjOpt = IWalnutAdminDecoratorTransformObjectOptions

  // field option
  interface IWalnutAdminDecoratorFieldObjectOptions
    extends IWalnutAdminDecoratorBasicOptions<
      IWalnutAdminDecoratorValidatorObjectOptions,
      IWalnutAdminDecoratorTransformObjectOptions
    > {}

  type IWADObjOpt = IWalnutAdminDecoratorFieldObjectOptions
}

export {}
