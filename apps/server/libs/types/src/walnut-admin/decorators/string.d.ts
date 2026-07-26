declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorStringOptions {
    booleanString?: boolean
    numberString?: boolean
    upper?: boolean
    lower?: boolean
    minLen?: number
    maxLen?: number
    url?: boolean
    phoneNumber?: boolean
    email?: boolean
    ip?: boolean
    onlyIn?: string[]
    nullable?: boolean
  }

  type IWADVStrOpt = IWalnutAdminDecoratorValidatorStringOptions

  // transform
  interface IWalnutAdminDecoratorTransformerStringRequestOptions {
    trim?: boolean
    lower?: boolean
    upper?: boolean
    booleanString?: boolean
  }

  type IWADTStrReqOpt = IWalnutAdminDecoratorTransformerStringRequestOptions

  interface IWalnutAdminDecoratorTransformerStringResponseOptions {
    trim?: boolean
    lower?: boolean
    upper?: boolean
    booleanString?: boolean
    phoneNumberMask?: boolean
    emailMask?: boolean
  }

  type IWADTStrResOpt = IWalnutAdminDecoratorTransformerStringResponseOptions

  interface IWalnutAdminDecoratorTransformStringOptions
    extends IWalnutAdminDecoratorTransformOptions<
      IWalnutAdminDecoratorTransformerStringRequestOptions,
      IWalnutAdminDecoratorTransformerStringResponseOptions
    > {}

  type IWADTStrOpt = IWalnutAdminDecoratorTransformStringOptions

  // field option
  interface IWalnutAdminDecoratorFieldStringOptions
    extends IWalnutAdminDecoratorBasicOptions<
      IWalnutAdminDecoratorValidatorStringOptions,
      IWalnutAdminDecoratorTransformStringOptions
    > {}

  type IWADStrOpt = IWalnutAdminDecoratorFieldStringOptions
}

export {}
