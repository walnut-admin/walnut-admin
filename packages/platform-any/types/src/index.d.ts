/**
 * `@walnut/types` 的包入口（barrel）。
 *
 * ADR 0013 规定**包入口用选择性、显式的具名 re-export**，`export *` 一次都不用 ——
 * 看这一个文件就知道本包对外承诺了什么。
 *
 * 2026-09-23（待办 R8）补上：此前本包是 6 个平台包里**唯一**既没有根导出、也没有
 * `src/index` 的一个，与 ADR 0013 不一致。子路径导入（`@walnut/types/storage`）继续可用、
 * 而且更精确 —— 两种写法都支持，没有要淘汰哪一个的意思。
 *
 * 本包是纯类型（`walnut.runtime: "none"`），所以根导出**零运行时成本**。
 *
 * ⚠️ 维护约定：`src/*.d.ts` 各自是一个模块，**新增模块时要在这里补一段具名 re-export**。
 * 反向的错（这里引用了已删除的模块）由 `pnpm types:check` 直接拦 —— `tsconfig.json` 的
 * `include` 覆盖 `src/` 下全部声明文件，本文件也在其中；正向的漏（新模块忘了导出）没有门禁，
 * 靠这段注释。四个模块之间目前**没有重名**。
 */

export type {
  IsFunction,
  IsPrimitive,
  NextDepth,
  NoDistribute,
  RecursionLimit,
} from './deep-ref'

export type {
  RecordToUnion,
  ShortEmits,
  UnionToIntersection,
} from './object-key'

export type {
  IStorageAsync,
  IStorageData,
  IStorageOptions,
  IStorageSync,
} from './storage'

export type {
  Fn,
  IActionType,
  PromiseFn,
} from './universal'
