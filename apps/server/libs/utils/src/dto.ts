import type { Type } from '@nestjs/common'
import type { Recordable } from 'easy-fns-ts'
import { PartialType, PickType } from '@nestjs/swagger'
import { Expose, plainToInstance } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { remove } from 'lodash'

// https://github.com/nestjs/swagger/issues/806#issuecomment-1467675007
// this function actually used `RealPickType` cause `@Exclude` do not work
export function RealOmitType<
  C extends Type<any>,
  K extends keyof InstanceType<C>,
>(
  classRef: C,
  keys: readonly K[],
): Type<Omit<InstanceType<C>, K>> {
  const realKeys = remove(
    Object.keys(plainToInstance(classRef, {}) as Recordable),
    i => !keys.includes(i as K),
  ) as (keyof InstanceType<C>)[]

  return RealPickType(classRef, realKeys)
}

export function RealPickType<
  C extends Type<any>,
  K extends keyof InstanceType<C>,
>(
  classRef: C,
  keys: readonly K[],
): Type<Pick<InstanceType<C>, K>> {
  const PickTypeClass = PickType(classRef, keys) as Type<any>

  if (keys.length === 0)
    return PickTypeClass as Type<Pick<InstanceType<C>, K>>

  keys.forEach((propertyKey) => {
    Expose()(PickTypeClass.prototype as Recordable, propertyKey as string)
  })

  return PickTypeClass as Type<Pick<InstanceType<C>, K>>
}

export function RealPartialType<
  C extends Type<any>,
>(
  classRef: C,
): Type<Partial<InstanceType<C>>> {
  const PartialTypeClass = PartialType(classRef) as Type<any>

  const keys = Object.keys(plainToInstance(PartialTypeClass, {}) as Recordable) as (keyof InstanceType<C>)[]
  if (keys.length === 0)
    return PartialTypeClass as Type<Partial<InstanceType<C>>>

  keys.forEach((propertyKey) => {
    IsOptional({ always: true })(
      PartialTypeClass.prototype as Recordable,
      propertyKey as string,
    )
  })

  return PartialTypeClass as Type<Partial<InstanceType<C>>>
}
