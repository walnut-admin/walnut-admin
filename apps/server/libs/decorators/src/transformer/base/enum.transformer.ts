import { applyDecorators } from '@nestjs/common'

const defaultReqOpt = (): IWADTEnumReqOpt => ({})

const defaultResOpt = (): IWADTEnumResOpt => ({})

export function WalnutAdminDecoratorTransformerEnum(
  options?: IWADTEnumOpt,
  _isArray?: boolean,
): PropertyDecorator {
  const decorators: PropertyDecorator[] = []

  const _reqOptions = Object.assign(defaultReqOpt(), options?.req ?? {})
  const _resOptions = Object.assign(defaultResOpt(), options?.res ?? {})

  return applyDecorators(...decorators)
}
