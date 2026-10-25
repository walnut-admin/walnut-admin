import { applyDecorators } from '@nestjs/common'
import { IsNotEmpty, IsUUID, Validate } from 'class-validator'

import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'
import { IsNullable } from '../common/nullable.validator'

/**
 * PostgreSQL `uuid` 主键的 DTO 校验（对应 Mongo 版 `WalnutAdminDecoratorValidatorMongoId`，
 * 校验内核换 class-validator 的 IsUUID）。不锁 uuid 版本 —— 存量 v4（gen_random_uuid）/
 * v7（uuidv7）/ v5（ETL 派生）三种 ID 通道都要放行（phase2 3.3）。
 */
export function defaultUuidOptions(): IWalnutAdminDecoratorValidatorUuidOptions {
  return {
    nullable: false,
  }
}

export function WalnutAdminDecoratorValidatorUuid(
  options?: IWADVUuidOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  let decorators: PropertyDecorator[] = [
    IsUUID(undefined, { each: isArray }),
    IsNotEmpty({ each: isArray }),
  ]

  const { validate, nullable } = Object.assign(defaultUuidOptions(), options)

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  if (validate) {
    decorators.push(
      Validate(validate, {
        each: isArray,
      }),
    )
  }

  if (nullable) {
    decorators.push(
      IsNullable({
        each: isArray,
      }),
    )
  }

  return applyDecorators(...decorators)
}
