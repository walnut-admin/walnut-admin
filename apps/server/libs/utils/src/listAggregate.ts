import type { PipelineStage, QueryFilter } from 'mongoose'
import { isEmpty, isNaN, isNil, isObject } from 'lodash'
import { isObjectIdOrHexString, Types } from 'mongoose'

/**
 * @description list request params interface (generic, no business dependency)
 */
export interface IListRequestParams<T> {
  query?: Partial<T>
  sort?: Array<{ field: string, order: 'ascend' | 'descend' | false, priority?: number }>
  page?: { page: number, pageSize: number }
}

/**
 * @description 定义列表查询的标准化参数结构
 */
interface IListQueryOptions {
  match: QueryFilter<Record<string, any>>
  sort: Record<string, 1 | -1>
  skip: number
  limit: number
}

/**
 * @description 构建标准的 MongoDB 列表查询参数 (Match, Sort, Skip, Limit)
 * 对应原: WalnutAdminListBaseParams2
 */
function buildListQuery<T>(
  params: Partial<IListRequestParams<T>> = {},
  extraMatch: Record<string, any> = {},
): IListQueryOptions {
  // 默认值
  const defaults: IListQueryOptions = {
    match: { ...extraMatch },
    sort: { createdAt: -1 }, // 默认按创建时间倒序
    skip: 0,
    limit: 10,
  }

  if (isEmpty(params) || Object.keys(params).length === 0) {
    return defaults
  }

  const { query, sort, page = { page: 1, pageSize: 10 } } = params

  // 1. 处理查询条件
  const match: Record<string, any> = { ...extraMatch }

  if (isObject(query) && Object.keys(query).length > 0) {
    Object.entries(query).forEach(([key, value]) => {
      // 跳过空值
      if (isNil(value))
        return

      // 字符串 -> 正则模糊匹配
      if (typeof value === 'string') {
        match[key] = { $regex: value, $options: 'i' }
        return
      }

      // 布尔值 -> 直接匹配
      if (typeof value === 'boolean') {
        match[key] = value
        return
      }

      // ObjectId -> 转换
      if (isObjectIdOrHexString(value)) {
        match[key] = new Types.ObjectId(String(value))
        return
      }

      // 数组处理
      if (Array.isArray(value) && value.length > 0) {
        // 日期范围判断: 检查数组元素是否都是有效日期字符串
        const isDateRange = value.every((v: string) => !isNaN(new Date(v).getTime()))

        if (isDateRange) {
          match[key] = {
            $gte: new Date(value[0] as string),
            $lt: new Date(value[1] as string),
          }
        }
        else {
          // 普通 In 查询
          match[key] = { $in: value }
        }
      }
    })
  }

  // 2. 处理排序
  let sortOptions: Record<string, 1 | -1> = defaults.sort
  if (Array.isArray(sort) && sort.length > 0) {
    const sortEntries = sort
      .filter(s => s.order !== false) // 过滤掉禁用排序的字段
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)) // 按优先级排序
      .map(s => [s.field, s.order === 'ascend' ? 1 : -1] as [string, 1 | -1])

    if (sortEntries.length > 0) {
      sortOptions = Object.fromEntries(sortEntries)
    }
  }

  // 3. 处理分页
  const skip = (Number(page.page) - 1) * Number(page.pageSize)
  const limit = Number(page.pageSize)

  return { match, sort: sortOptions, skip, limit }
}

/**
 * @description 构建聚合管道
 * 对应原: WalnutAdminListAggregate
 */
function createListAggregation(
  { match, sort, skip, limit }: IListQueryOptions,
  extraPipeline: PipelineStage[] = [],
  sortAfter = false, // 是否在 extraPipeline 之后排序 (通常用于 $lookup 或 $group 后的结果排序)
): PipelineStage[] {
  const baseStages: PipelineStage[] = [{ $match: match }]

  // 前置排序 (利用索引)
  if (!isEmpty(sort) && !sortAfter) {
    baseStages.push({ $sort: sort })
  }

  const pipeline: PipelineStage[] = [
    ...baseStages,
    ...extraPipeline,
  ]

  // 后置排序 (用于处理加工后的数据)
  if (!isEmpty(sort) && sortAfter) {
    pipeline.push({ $sort: sort })
  }

  // 使用 Facet 同时获取数据和总数
  pipeline.push({
    $facet: {
      data: [
        { $skip: skip },
        { $limit: limit },
      ],
      total: [
        { $count: 'total' },
      ],
    },
  })

  // ✅ 核心优化: 添加 $project 阶段，直接拍平 total 结构
  // 结果将变为: [{ data: [...], total: 10 }] 而不是 [{ data: [...], total: [{ total: 10 }] }]
  pipeline.push({
    $project: {
      data: 1,
      total: { $ifNull: [{ $arrayElemAt: ['$total.total', 0] }, 0] }, // 自动处理 total 为空的情况
    },
  })

  return pipeline
}

/**
 * @description 【推荐使用】组合函数：一步到位将请求参数转换为 Aggregation Pipeline
 * 对应你的需求: 将两个函数捏造成一个使用
 */
export function buildListPipelineFromRequest<T>(
  params: IListRequestParams<T>,
  extraPipeline: PipelineStage[] = [],
  sortAfter = false,
  extraMatch: Record<string, any> = {},
) {
  const queryOptions = buildListQuery(params, extraMatch)
  return createListAggregation(queryOptions, extraPipeline, sortAfter)
}
