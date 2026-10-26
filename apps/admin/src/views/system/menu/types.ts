import type { ConvertNestedProperties, NullableRecord } from 'easy-fns-ts'
import type { IModels } from '@/api/models'

// 菜单表单载荷：create 时无 id（服务端生成 uuid），update 时由 read 回填 —— id 保持可选，
// 其余字段沿用 NullableRecord 全可空形态
export type IAppSystemMenuForm = NullableRecord<Omit<ConvertNestedProperties<IModels.SystemMenu, 'meta'>, 'id'>>
  & { id?: string }
