declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorDateOptions {
    stringDate?: boolean
  }

  type IWADVDateOpt = IWalnutAdminDecoratorValidatorDateOptions

  // transform
  interface IWalnutAdminDecoratorTransformerDateRequestOptions {}

  type IWADTDateReqOpt = IWalnutAdminDecoratorTransformerDateRequestOptions

  interface IWalnutAdminDecoratorTransformerDateResponseOptions {
    format?: string
  }

  type IWADTDateResOpt = IWalnutAdminDecoratorTransformerDateResponseOptions

  interface IWalnutAdminDecoratorTransformDateOptions
    extends IWalnutAdminDecoratorTransformOptions<
      IWalnutAdminDecoratorTransformerDateRequestOptions,
      IWalnutAdminDecoratorTransformerDateResponseOptions
    > {}

  type IWADTDateOpt = IWalnutAdminDecoratorTransformDateOptions

  // field option
  interface IWalnutAdminDecoratorFieldDateOptions
    extends IWalnutAdminDecoratorBasicOptions<
      IWalnutAdminDecoratorValidatorDateOptions,
      IWalnutAdminDecoratorTransformDateOptions
    > {}

  type IWADDateOpt = IWalnutAdminDecoratorFieldDateOptions
}

export {}
