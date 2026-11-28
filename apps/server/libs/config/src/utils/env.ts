/**
 * 运行环境判定的兼容入口。
 *
 * 判定本身已下沉到 `@walnut-server/const/app/env`（纯 `process.env` 读，放到最低叶子，
 * 消除 const ↔ config ↔ utils 的同层 SCC，见那边的注释）。保留本文件是因为
 * `@walnut-server/config/utils/env` 是既有的公共导入路径，全部改调用点只会扩大改动面；
 * 转发值与原实现完全一致。
 *
 * 只转发**经这条路径消费的**两个谓词：`isDev` / `isProd`（i18n、logger、cookie、guards、
 * mailer 等）。`isStage` 与 `WalnutAdminEnv` 全仓都直接从 `@walnut-server/const/app/env`
 * 取，这里的再导出零消费，已随兼容层清理删除（2026-11-28）。
 */
export { isDev, isProd } from '@walnut-server/const/app/env'
