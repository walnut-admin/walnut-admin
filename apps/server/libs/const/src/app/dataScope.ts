import type { DataScopeKey } from '@walnut/contract/data-scope'
import type { ValueOf } from 'easy-fns-ts'
import { DataScope as DataScopeContract } from '@walnut/contract/data-scope'

/**
 * 角色数据权限档位（`sys_role.data_scope` smallint）—— **数值真源在 `@walnut/contract`**
 * （`packages/platform-any/contract/src/data-scope.ts`，含每档语义与两个易误解点）。
 *
 * 本文件只做「既有导出名 → 契约常量」的再导出：server 全仓（DTO enum 校验、解析器、
 * 迁移 CHECK 口径）都经 `@walnut-server/const/app/dataScope` 消费，数值与键名一律由
 * 契约派生 —— 六档数值（1..6）是不可变契约，DDL 的
 * `CHECK (data_scope IN (1, 2, 3, 4, 5, 6))` 必须与之一致。
 *
 * 历史（别改回旧值）：一期三档是 1 ALL / 2 SELF / 3 CUSTOM（角色成员），二期重排为上面
 * 的六档 —— 迁移 `1793340000000-DataScopePhase2Dept.ts` 按「旧 2 → 新 5、旧 3 → 新 2」
 * 重映射存量行；数值已是存量数据 + DDL CHECK 的一部分。
 */
export const WalnutAdminConstDataScope = DataScopeContract

export type IWalnutAdminConstDataScope = ValueOf<typeof WalnutAdminConstDataScope>

/**
 * 解析后的运行时模式串（描述符 `mode` 的取值）。值 = 档位键名，与数值档位一一对应：
 * `toWalnutDataScopeMode` 负责映射（common/repository/data-scope.ts）。
 *
 * `satisfies { readonly [K in DataScopeKey]: K }` 是编译期机械守卫：契约增删档位时，
 * 这里漏配 / 多配 / 值写错都会让 `pnpm types:check` 直接红（否则漏配会静默落到 default
 * 的「默认拒绝」，多配则是一段永不命中的死分支）。
 */
export const WalnutAdminConstDataScopeMode = {
  ALL: 'ALL',
  CUSTOM: 'CUSTOM',
  DEPT: 'DEPT',
  DEPT_AND_CHILD: 'DEPT_AND_CHILD',
  SELF: 'SELF',
  DEPT_OR_SELF: 'DEPT_OR_SELF',
} as const satisfies { readonly [K in DataScopeKey]: K }

export type IWalnutAdminConstDataScopeMode = ValueOf<typeof WalnutAdminConstDataScopeMode>
