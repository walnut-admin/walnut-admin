import type { Fn } from './universal'
// 基础类型检查
export type IsPrimitive<T>
  = T extends string | number | boolean | null | undefined | symbol | bigint ? true : false

// 函数类型检查
export type IsFunction<T> = T extends Fn ? true : false

// 避免分布式条件类型
export type NoDistribute<T> = [T] extends [unknown] ? T : never

// 只处理明确的对象类型
export type IsRecursible<T>
  = T extends string | number | boolean | null | undefined | symbol | bigint | Fn | Ref<any> ? false
    : T extends object ? true
      : false

// 设置最大递归深度
export type RecursionLimit = 10

// 辅助类型：计算下一层深度
export type NextDepth<D extends number> = [
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
][D]

// 将数组处理和对象处理分离
export type ProcessArray<T, D extends number>
  = T extends Array<infer U> ? Array<SafeDeepMaybeRef<U, D>> : never

export type ProcessObject<T, D extends number>
  = [T] extends [object] ? { [K in keyof T]: SafeDeepMaybeRef<T[K], D> } : never

// 安全的深度递归类型
export type SafeDeepMaybeRef<T, Depth extends number = 0>
  = Depth extends RecursionLimit ? MaybeRefOrGetter<T>
    : T extends string ? MaybeRefOrGetter<string>
      : T extends boolean ? MaybeRefOrGetter<boolean>
        : T extends number ? MaybeRefOrGetter<number>
          : IsPrimitive<T> extends true ? MaybeRefOrGetter<T>
            : T extends Ref<infer V> ? MaybeRefOrGetter<V>
              : T extends Array<any> ? ProcessArray<T, NextDepth<Depth>>
                : IsFunction<T> extends true ? T
                  : NoDistribute<T> extends object
                    ? IsRecursible<T> extends true
                      ? ProcessObject<T, NextDepth<Depth>>
                      : MaybeRefOrGetter<T>
                    : MaybeRefOrGetter<T>

export type IDeepMaybeRef<T> = SafeDeepMaybeRef<T>
