import type { IsFunction, IsPrimitive, NextDepth, NoDistribute, RecursionLimit } from '@walnut/types/deep-ref'
import type { Fn } from '@walnut/types/universal'
import type { MaybeRefOrGetter, Ref } from 'vue'

// 只处理明确的对象类型
export type IsRecursible<T>
  = T extends string | number | boolean | null | undefined | symbol | bigint | Fn | Ref<any> ? false
    : T extends object ? true
      : false

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
