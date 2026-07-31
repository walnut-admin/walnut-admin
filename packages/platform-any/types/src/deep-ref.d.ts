import type { Fn } from './universal'

// 基础类型检查
export type IsPrimitive<T>
  = T extends string | number | boolean | null | undefined | symbol | bigint ? true : false

// 函数类型检查
export type IsFunction<T> = T extends Fn ? true : false

// 避免分布式条件类型
export type NoDistribute<T> = [T] extends [unknown] ? T : never

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
