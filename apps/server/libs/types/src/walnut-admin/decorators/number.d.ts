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
    /**
     * 可缺省（批次 1 · R3 P2-4）：缺省时跳过本字段全部校验，其余值仍按上面各项校验。
     *
     * 与「字段装饰器传 `default`」的区别：`default` 会进 swagger（`schema.default` +
     * 可能把字段移出 `required`），本项**不进 swagger** —— 用于「实现上允许缺省、
     * 但本轮不改 openapi 契约」的场景（如 `sort[].priority`）。
     */
    optional?: boolean
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
