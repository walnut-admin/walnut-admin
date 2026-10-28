import type { SystemMenu } from '@walnut/api-types'
import type { ConvertNestedProperties, NullableRecord } from 'easy-fns-ts'

// 菜单表单载荷：create 时无 id（服务端生成 uuid），update 时由 read 回填 —— id 保持可选。
// 生成 SystemMenu（SysMenuDTOSafe）业务字段全必填，表单是逐字段可空/可选的消费面：
// NullableRecord 只做空值联合不降必填，外面再包一层 Partial。
export type IAppSystemMenuForm = Partial<NullableRecord<Omit<ConvertNestedProperties<SystemMenu, 'meta'>, 'id'>>>
  & { id?: string }
