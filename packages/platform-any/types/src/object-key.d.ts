export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never

export type RecordToUnion<T extends Record<string, any>> = T[keyof T]

export type ShortEmits<T extends Record<string, any>> = UnionToIntersection<RecordToUnion<{
  [K in keyof T]: (evt: K, ...args: T[K]) => void;
}>>
