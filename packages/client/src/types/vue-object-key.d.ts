import type { UnwrapRef } from 'vue'

export type DeepKeyOf<T> = T extends object
  ? {
      [K in keyof T]: K extends string | number
        ? UnwrapRef<T[K]> extends object
          ? `${K}` | `${K}.${DeepKeyOf<UnwrapRef<T[K]>> & string}`
          : `${K}`
        : never;
    }[keyof T]
  : never
