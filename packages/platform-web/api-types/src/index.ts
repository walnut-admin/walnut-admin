/**
 * OpenAPI 生成类型的消费入口 —— 生成物 `./schema.d.ts` 由 `pnpm generate`
 * （openapi-typescript）从 `apps/server/openapi.json` 产出，**不许手改**；
 * 本文件只做 re-export 与「菜单模块别名」（一期只接 menu，其余模块二期）。
 *
 * 一致性：prepush 的「openapi 一致性」段跑 导出 → 生成 → `git diff --exit-code`，
 * server DTO 漂移会在这里变红。
 */
import type { components } from './schema'

export type { components, paths } from './schema'

/**
 * server `SysMenuDTOSafe`（menu 模块 Safe DTO）的生成别名 —— admin 侧 menu 链路的 wire 真源。
 *
 * 唯一的显式细化是 `id: string`：swagger 里 id 标成可选（同一个 DTO 类兼任 list 查询过滤，
 * 那里 id 可选），但 Safe 响应经 ClassSerializer **必含** id（uuid）—— 这是响应侧恒真的事实，
 * 同时让 `BaseAPI<T extends { id: string }>` 的泛型约束对生成类型继续成立。
 */
export type SystemMenu = components['schemas']['SysMenuDTOSafe'] & { id: string }

/**
 * server `SysMenuDTOTree`（menu 树节点：Safe 剔 pid/createdAt/updatedAt + children）的生成别名。
 * 生成形态自带 `children?: SystemMenuTree[]`，与前端 `TreeNodeItem<T>` 的包装同构，
 * tree 接口响应直接可用。
 */
export type SystemMenuTree = components['schemas']['SysMenuDTOTree']
