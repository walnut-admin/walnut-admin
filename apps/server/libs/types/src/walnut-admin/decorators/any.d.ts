declare global {
  // validate：任意形态字段**不做类型校验**（语义裁决在消费方）
  interface IWalnutAdminDecoratorValidatorAnyOptions {}

  type IWADVAnyOpt = IWalnutAdminDecoratorValidatorAnyOptions

  // transform：不做任何变换
  interface IWalnutAdminDecoratorTransformerAnyRequestOptions {}

  interface IWalnutAdminDecoratorTransformerAnyResponseOptions {}

  interface IWalnutAdminDecoratorTransformAnyOptions
    extends IWalnutAdminDecoratorTransformOptions<
      IWalnutAdminDecoratorTransformerAnyRequestOptions,
      IWalnutAdminDecoratorTransformerAnyResponseOptions
    > {}

  type IWADTAnyOpt = IWalnutAdminDecoratorTransformAnyOptions

  // field option
  interface IWalnutAdminDecoratorFieldAnyOptions
    extends IWalnutAdminDecoratorBasicOptions<
      IWalnutAdminDecoratorValidatorAnyOptions,
      IWalnutAdminDecoratorTransformAnyOptions
    > {}

  type IWADAnyOpt = IWalnutAdminDecoratorFieldAnyOptions
}

export {}
