declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorNumberOptions {
    positive?: boolean
    negative?: boolean
    max?: number
    min?: number
    int?: boolean
    onlyIn?: number[]
    precision?: number
  }

  type IWADVNumOpt = IWalnutAdminDecoratorValidatorNumberOptions

  // transform
  interface IWalnutAdminDecoratorTransformerNumberRequestOptions {
    defaultTransform?: boolean
  }

  type IWADTNumReqOpt = IWalnutAdminDecoratorTransformerNumberRequestOptions

  interface IWalnutAdminDecoratorTransformerNumberResponseOptions {
    precision?: number
    round?: boolean
    defaultTransform?: boolean
  }

  type IWADTNumResOpt = IWalnutAdminDecoratorTransformerNumberResponseOptions

  interface IWalnutAdminDecoratorTransformNumberOptions
    extends IWalnutAdminDecoratorTransformOptions<
      IWalnutAdminDecoratorTransformerNumberRequestOptions,
      IWalnutAdminDecoratorTransformerNumberResponseOptions
    > {}

  type IWADTNumOpt = IWalnutAdminDecoratorTransformNumberOptions

  // field option
  interface IWalnutAdminDecoratorFieldNumberOptions
    extends IWalnutAdminDecoratorBasicOptions<
      IWalnutAdminDecoratorValidatorNumberOptions,
      IWalnutAdminDecoratorTransformNumberOptions
    > {}

  type IWADNumOpt = IWalnutAdminDecoratorFieldNumberOptions
}

export {}
