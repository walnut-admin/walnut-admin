import {
  ArrayContains,
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotContains,
  ArrayUnique,
  IsArray,
  isNumber,
} from 'class-validator'

export function WalnutAdminDecoratorValidatorArray(
  decorators: PropertyDecorator[],
  options?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator[] {
  const _decorators = [...decorators]

  _decorators.push(IsArray({}))

  if (options?.unique) {
    _decorators.push(ArrayUnique({}))
  }

  if (Array.isArray(options?.contains) && options.contains.length !== 0) {
    _decorators.push(ArrayContains(options.contains, {}))
  }

  if (Array.isArray(options?.notContains) && options.notContains.length !== 0) {
    _decorators.push(ArrayNotContains(options.notContains, {}))
  }

  if (isNumber(options?.maxSize)) {
    _decorators.push(ArrayMaxSize(options?.maxSize, {}))
  }

  if (isNumber(options?.minSize)) {
    _decorators.push(ArrayMinSize(options?.minSize, {}))
  }

  return _decorators
}
