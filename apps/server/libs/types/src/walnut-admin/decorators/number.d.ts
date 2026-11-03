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
     * 可缺省：缺省时跳过本字段全部校验，其余值仍按上面各项校验。
     *
     * **同时进 swagger**：`field/number.decorator.ts` 把它翻成 `ApiProperty({ required: false })`，
     * 该字段因此不出现在 schema 的 `required` 里 —— 可选性的真源只有这一个开关，
     * 别在 `swaggerOptions` 里再写一遍 `required`（写了会覆盖它，两处必然漂移）。
     *
     * 与「字段装饰器传 `default`」的区别：`default` 进的是 `schema.default`（语义是
     * 「不传时按这个值算」，值域会变成已知）；本项只表达「可以不传」，不给默认值。
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
