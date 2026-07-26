declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorEnumOptions {}

  type IWADVEnumOpt = IWalnutAdminDecoratorValidatorEnumOptions

  // transform
  interface IWalnutAdminDecoratorTransformerEnumRequestOptions {}

  type IWADTEnumReqOpt = IWalnutAdminDecoratorTransformerEnumRequestOptions

  interface IWalnutAdminDecoratorTransformerEnumResponseOptions {}

  type IWADTEnumResOpt = IWalnutAdminDecoratorTransformerEnumResponseOptions

  interface IWalnutAdminDecoratorTransformEnumOptions
    extends IWalnutAdminDecoratorTransformOptions<
      IWalnutAdminDecoratorTransformerEnumRequestOptions,
      IWalnutAdminDecoratorTransformerEnumResponseOptions
    > {}

  type IWADTEnumOpt = IWalnutAdminDecoratorTransformEnumOptions

  // field option
  interface IWalnutAdminDecoratorFieldEnumOptions
    extends IWalnutAdminDecoratorBasicOptions<
      IWalnutAdminDecoratorValidatorEnumOptions,
      IWalnutAdminDecoratorTransformEnumOptions
    > {}

  type IWADEnumOpt = IWalnutAdminDecoratorFieldEnumOptions
}

export {}
