import type { Type } from '@nestjs/common'
import type { Recordable } from 'easy-fns-ts'
import { PartialType, PickType } from '@nestjs/swagger'
import { Expose, plainToInstance } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { remove } from 'lodash'

// https://github.com/nestjs/swagger/issues/806#issuecomment-1467675007
// this function actually used `RealPickType` cause `@Exclude` do not work

/**
 * swagger 的 schema 键名取自 `class.name`，而 @nestjs/swagger 的 PartialType / PickType
 * 内部固定生成 `class PartialTypeClass` / `class PickTypeClass` —— 不改名的话**所有**
 * 派生类共用同一个 schema 键，文档里 N 个不同形态互相覆盖（导出 openapi.json 后由
 * openapi-typescript 生成类型时更会以错传错）。这里按 `@walnut-server/list` 的既有
 * 先例（"dynamic change class name (swagger relies on this)"）改名，键名只进文档面，
 * 运行时行为（校验 / 转换 / 序列化）不读 class.name。
 */
function withSwaggerSchemaName(cls: Type<any>, name: string): Type<any> {
  Object.defineProperty(cls, 'name', { value: name })
  return cls
}

/** pick 键拼进 schema 名：同基类的不同 PickType 形态也要互不撞键（键序即调用序，稳定） */
function pickSchemaName(classRef: Type<any>, keys: readonly PropertyKey[]): string {
  const suffix = keys.map((key) => {
    const k = String(key)
    return k.charAt(0).toUpperCase() + k.slice(1)
  }).join('')
  return `${classRef.name}Pick${suffix}`
}

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
    return withSwaggerSchemaName(PickTypeClass, pickSchemaName(classRef, keys)) as Type<Pick<InstanceType<C>, K>>

  keys.forEach((propertyKey) => {
    Expose()(PickTypeClass.prototype as Recordable, propertyKey as string)
  })

  return withSwaggerSchemaName(PickTypeClass, pickSchemaName(classRef, keys)) as Type<Pick<InstanceType<C>, K>>
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

  return withSwaggerSchemaName(PartialTypeClass, `${classRef.name}Partial`) as Type<Partial<InstanceType<C>>>
}
