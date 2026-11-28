import type { Type } from '@nestjs/common'
import type { TransformFnParams } from 'class-transformer'
import type { Recordable } from 'easy-fns-ts'
import { PartialType, PickType } from '@nestjs/swagger'
import { Expose, plainToInstance, Transform } from 'class-transformer'
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
  const suffix = keys
    .map((key) => {
      const k = String(key)
      return k.charAt(0).toUpperCase() + k.slice(1)
    })
    .join('')
  return `${classRef.name}Pick${suffix}`
}

export function RealOmitType<C extends Type<any>, K extends keyof InstanceType<C>>(
  classRef: C,
  keys: readonly K[],
): Type<Omit<InstanceType<C>, K>> {
  const realKeys = remove(
    Object.keys(plainToInstance(classRef, {}) as Recordable),
    (i) => !keys.includes(i as K),
  ) as (keyof InstanceType<C>)[]

  return RealPickType(classRef, realKeys)
}

export function RealPickType<C extends Type<any>, K extends keyof InstanceType<C>>(
  classRef: C,
  keys: readonly K[],
): Type<Pick<InstanceType<C>, K>> {
  const PickTypeClass = PickType(classRef, keys) as Type<any>

  if (keys.length === 0)
    return withSwaggerSchemaName(PickTypeClass, pickSchemaName(classRef, keys)) as Type<
      Pick<InstanceType<C>, K>
    >

  keys.forEach((propertyKey) => {
    Expose()(PickTypeClass.prototype as Recordable, propertyKey as string)
  })

  return withSwaggerSchemaName(PickTypeClass, pickSchemaName(classRef, keys)) as Type<
    Pick<InstanceType<C>, K>
  >
}

export interface RealPartialTypeOptions {
  /**
   * 真 PATCH 语义（update DTO 专用）：请求体里**没出现**的键保持 undefined，不让字段
   * 装饰器的 `nil → null` 转换把它伪造成显式 null。
   *
   * 为什么需要：`@walnut-server/decorators/field` 的 string / boolean 字段在
   * `toClassOnly` 阶段统一把 nil 落成 null（给 create 的默认值兜底用）。但 PLAIN_TO_CLASS
   * 会对**所有 @Expose 键**跑 Transform（class-transformer 的 getKeys 含 exposed metadata），
   * 未提供的键也被写成 null —— update 把整个 DTO 交给 repo.update 时，未给的列会被
   * `UPDATE … SET col = NULL` 覆盖（menu update 的历史 bug：只改 title 会清掉 name 等）。
   *
   * 实现：preserveAbsent 时在 swagger 的 PartialType 结果外**再包一层子类**，把收尾
   * Transform 注册在子类自身 —— class-transformer 的 metadata 查找会先祖先后本类，
   * 同一 target 上的多个 Transform 实际执行序又与注册序相反。swagger `PartialType` 是
   * 「复制派生类」而非继承（字段装饰器的 Transform 被复制到父类 target 上），只有把我们
   * 的收尾 Transform 放到**真正派生类**的 target，才能确保它在字段装饰器转换之后执行。
   * 源对象里没有该键就返回 undefined：全局 ValidationPipe 的 `exposeUnsetFields: false`
   * 会跳过 undefined 赋值，键因此不落到实例上；即使调用方打开了 exposeUnsetFields，
   * service 侧对 undefined 的过滤仍然成立。显式传 null（清空字段）原样保留。
   */
  preserveAbsent?: boolean
}

export function RealPartialType<C extends Type<any>>(
  classRef: C,
  options: RealPartialTypeOptions = {},
): Type<Partial<InstanceType<C>>> {
  const PartialTypeClass = PartialType(classRef) as Type<any>

  const keys = Object.keys(
    plainToInstance(PartialTypeClass, {}) as Recordable,
  ) as (keyof InstanceType<C>)[]
  if (keys.length === 0) return PartialTypeClass as Type<Partial<InstanceType<C>>>

  // preserveAbsent：子类落点（见 options 注释里「为什么需要再包一层」）
  const TargetClass = options.preserveAbsent
    ? class extends (PartialTypeClass as unknown as Type<object>) {}
    : PartialTypeClass

  keys.forEach((propertyKey) => {
    IsOptional({ always: true })(TargetClass.prototype as Recordable, propertyKey as string)
  })

  if (options.preserveAbsent) {
    keys.forEach((propertyKey) => {
      Transform(
        ({ value, obj, key }: TransformFnParams): unknown => {
          const source = obj as Recordable | null | undefined
          if (source === null || source === undefined || typeof key !== 'string')
            return value as unknown

          return Object.hasOwn(source, key) ? (value as unknown) : undefined
        },
        { toClassOnly: true },
      )(TargetClass.prototype as Recordable, propertyKey as string)
    })
  }

  return withSwaggerSchemaName(TargetClass, `${classRef.name}Partial`) as Type<
    Partial<InstanceType<C>>
  >
}
