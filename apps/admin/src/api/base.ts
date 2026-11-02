import type { BaseListParams, BaseListResponse } from '@walnut/contract'
import type { StringOrNumber } from 'easy-fns-ts'
import { omit } from 'lodash-es'
import { AppAxios } from '@/utils/axios'

export type BaseAPIType<T extends { id: string }> = InstanceType<typeof BaseAPI<T>>

function omitUnnecessaryFields<T extends { id?: string }>(data: T) {
  // PG 化后主键是 id（uuid）：create 不带 id（服务端生成），update 的 id 只走 URL 参数，
  // body 一律剔除（服务端 Safe DTO 的 RealPickType 也不收 id）
  return omit(data, ['id', 'createdAt', 'updatedAt'])
}

/**
 * 泛型约束为 `{ id: string }`：全模块（codegen 二期起）直接消费
 * `@walnut/api-types` 的生成别名（`createdAt` 是 string、`pid` 可空 —— 与旧手写
 * IModels.Base 的 Date/必填形态不同），手写镜像 models.d.ts 已退役。
 */
export class BaseAPI<T extends { id: string }> {
  private readonly baseAPI: string

  constructor({ model, section }: { model: string, section: string }) {
    this.baseAPI = `/${model}/${section}`
  }

  list(data?: BaseListParams<T>) {
    return AppAxios.post<BaseListResponse<T>>({
      url: `${this.baseAPI}/list`,
      data,
    })
  }

  create(data: T) {
    return AppAxios.post(
      {
        url: `${this.baseAPI}`,
        data: omitUnnecessaryFields<T>(data),
      },
    )
  }

  read(id: StringOrNumber) {
    return AppAxios.get<T>({
      url: `${this.baseAPI}/${id}`,
    })
  }

  // fix src/components/Advanced/CRUD/index.vue onYes
  detail() {}

  update(data: T) {
    return AppAxios.put<T>(
      {
        url: `${this.baseAPI}/${data.id}`,
        data: omitUnnecessaryFields<T>(data),
      },
    )
  }

  delete(id: StringOrNumber) {
    return AppAxios.delete<T>(
      {
        url: `${this.baseAPI}/${id}`,
      },
    )
  }

  deleteMany(id: string) {
    return AppAxios.delete<T[]>(
      {
        url: `${this.baseAPI}/deleteMany/${id}`,
      },
    )
  }

  clear() {
    return AppAxios.delete<T>(
      {
        url: `${this.baseAPI}/clear`,
      },
    )
  }
}
