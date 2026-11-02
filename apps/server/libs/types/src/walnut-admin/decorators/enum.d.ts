declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorEnumOptions {
    /**
     * 允许字面量 `false` 绕过枚举校验（批次 1 · `sort[].order`）。
     *
     * 契约里 `SortOrder = 'ascend' | 'descend' | false`（`contract/pagination.ts:8`），
     * `false` 表示"该列不排序"；但 `IsEnum(SortOrderValues)` 的枚举只有 ascend/descend。
     * 打开后 `false` 跳过本字段全部校验（`ValidateIf`），其余值仍走枚举。
     */
    allowFalseValue?: boolean
  }

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
