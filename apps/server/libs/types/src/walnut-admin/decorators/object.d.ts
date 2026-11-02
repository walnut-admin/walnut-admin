declare global {
  // validate
  interface IWalnutAdminDecoratorValidatorObjectOptions {
    required?: boolean
    any?: boolean
    /**
     * `required: false` 时仍然**下钻校验**（批次 1 · list 三槽位）。
     *
     * 缺省 false ⇒ 维持历史语义：只 `Allow()`，不 ValidateNested。
     * 打开后：可缺省 / null，但**一旦给了就按内层 DTO 的约束校验**
     * （`sort[].field` 的 onlyIn 白名单、`page.pageSize` 的 max、`query` 各字段的类型）。
     *
     * 注意：全局 ValidationPipe 开了 `forbidNonWhitelisted`，因此打开后内层**未声明键**
     * 也会 400 —— 这正是"契约即真相"，但只在确实要收敛的槽位上开。
     */
    nestedWhenPresent?: boolean
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
