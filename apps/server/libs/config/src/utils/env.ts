/**
 * 运行环境判定的兼容入口。
 *
 * 判定本身已下沉到 `@walnut-server/const/app/env`（纯 `process.env` 读，放到最低叶子，
 * 消除 const ↔ config ↔ utils 的同层 SCC，见那边的注释）。保留本文件是因为
 * `@walnut-server/config/utils/env` 是既有的公共导入路径，全部改调用点只会扩大改动面；
 * 转发值与原实现完全一致。
 */
export { isDev, isProd, isStage, WalnutAdminEnv } from '@walnut-server/const/app/env'
