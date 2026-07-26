declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorBooleanOptions {}

  type IWADVBoolOpt = IWalnutAdminDecoratorValidatorBooleanOptions

  // transform
  interface IWalnutAdminDecoratorTransformerBooleanRequestOptions {
    stringBoolean?: boolean
  }

  type IWADTBoolReqOpt = IWalnutAdminDecoratorTransformerBooleanRequestOptions

  interface IWalnutAdminDecoratorTransformerBooleanResponseOptions {
    stringBoolean?: boolean
  }

  type IWADTBoolResOpt = IWalnutAdminDecoratorTransformerBooleanResponseOptions

  interface IWalnutAdminDecoratorTransformBooleanOptions
    extends IWalnutAdminDecoratorTransformOptions<
      IWalnutAdminDecoratorTransformerBooleanRequestOptions,
      IWalnutAdminDecoratorTransformerBooleanResponseOptions
    > {}

  type IWADTBoolOpt = IWalnutAdminDecoratorTransformBooleanOptions

  // field option
  interface IWalnutAdminDecoratorFieldBooleanOptions
    extends IWalnutAdminDecoratorBasicOptions<
      IWalnutAdminDecoratorValidatorBooleanOptions,
      IWalnutAdminDecoratorTransformBooleanOptions
    > {}

  type IWADBoolOpt = IWalnutAdminDecoratorFieldBooleanOptions
}

export {}
