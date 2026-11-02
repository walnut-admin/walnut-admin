import type { ClassConstructor, TransformOptions } from 'class-transformer'
import { plainToInstance, Transform } from 'class-transformer'
import { cloneDeep, isNil, isPlainObject } from 'lodash'

/**
 * 缺省值填充（toClassOnly / toPlainOnly 双向）。
 *
 * `obj` 可选：给了就把**裸对象默认值**实例化成该 DTO 的实例。
 *
 * 为什么需要这一步（批次 1 · P0）：list 的 `page` 槽位默认值是 `{ page: 1, pageSize: 10 }`，
 * 而 `@Type(() => WalnutAdminRequestListPageDTO)` 只在"值存在"时实例化 —— 缺省时字段停在
 * plain object 上。一旦该槽位挂了 `ValidateNested`，class-validator 对非实例对象只报
 * `unknownValue`（`forbidUnknownValues`），于是"什么都没传"反而 400。
 *
 * 注意：必须在这里做、而不是外面再挂一个 `@Transform` —— class-transformer 对同一属性上
 * 多个 `@Transform` 的实际执行序与注册序相反，外挂那个会在默认值填充**之前**跑，
 * 拿到 undefined 直接返回（实测踩过）。
 */
export function WalnutAdminDecoratorTransformDefault(
  defaultValue: unknown,
  isArray: boolean = false,
  options: TransformOptions = {},
  obj?: ClassConstructor<unknown>,
) {
  const instantiate = (value: unknown): unknown => {
    if (obj === undefined || value === null || value === undefined) {
      return value
    }
    const cls = obj as ClassConstructor<object>
    const toInstance = (input: unknown): unknown => plainToInstance(cls, input as object)

    if (isArray && Array.isArray(value)) {
      return value.map((item: unknown) => isPlainObject(item) ? toInstance(item) : item)
    }
    return isPlainObject(value) ? toInstance(value) : value
  }

  return Transform(({ value }: { value: unknown }) => {
    if (isNil(value)) {
      return isArray ? [] : instantiate(cloneDeep(defaultValue))
    }

    if (isArray && Array.isArray(value)) {
      return value.map((item: unknown) => isNil(item) ? instantiate(cloneDeep(defaultValue)) : item)
    }

    // 单个值直接返回
    return value
  }, options)
}
