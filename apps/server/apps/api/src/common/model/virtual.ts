import type { Schema } from 'mongoose'

export interface AddVirtualOptions {
  /**
   * virtual 字段�?
   */
  virtualPath: string
  /**
   * 引用�?Model 名称
   */
  ref: string
  /**
   * 本地字段
   */
  localField: string
  /**
   * 外键字段
   */
  foreignField: string
  /**
   * 是否只返回一�?
   */
  justOne?: boolean
  /**
   * 投影
   */
  projection?: Record<string, number | string> | string
  /**
   * 额外�?match 条件
   */
  match?: Record<string, any>

  /**
   * 是否返回 count
   */
  count?: boolean
}

/**
 * 通用的添�?virtual 方法
 */
export function addVirtual(schema: Schema, options: AddVirtualOptions) {
  const { virtualPath, ref, localField, foreignField, justOne, projection, match, count } = options

  schema.virtual(virtualPath, {
    ref,
    localField,
    foreignField,
    justOne,
    ...(count ? { options: { count: true } } : {}),
    ...(projection !== null ? { options: { projection } } : {}),
    ...(match ? { match } : {}),
  })

  return schema
}
