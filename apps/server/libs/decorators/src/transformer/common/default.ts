import type { TransformOptions } from 'class-transformer'
import { Transform } from 'class-transformer'
import { cloneDeep, isNil } from 'lodash'

export function WalnutAdminDecoratorTransformDefault(
  defaultValue: unknown,
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (isNil(value)) {
      return isArray ? [] : cloneDeep(defaultValue)
    }

    if (isArray && Array.isArray(value)) {
      return value.map((item: unknown) => isNil(item) ? cloneDeep(defaultValue) : item)
    }

    // 单个值直接返回
    return value
  }, options)
}
