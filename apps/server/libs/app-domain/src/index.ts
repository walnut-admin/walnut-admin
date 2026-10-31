/**
 * app 域 barrel（libs 解耦批 9）—— lib 抽取的最后一批。
 *
 * demo / error / key / logger / monitor / setting 六个应用级子域 + shared 目录的
 * 最后三件（area / ali / mask）。controller 与 DTO 的处置按依赖方向逐个判定：
 *
 * - 可整体下沉：demo / error / key / logger / monitor.cache / monitor.server /
 *   setting 的 controller 与全部 area / ali / mask 代码 —— 依赖全在
 *   `@walnut-server/{guards,crud,decorators,pipes,identity,...}`。
 * - 留 app：`monitor/user` 的 controller + wire DTO（virtual user 引 app 的
 *   `SysUserDTOSafe`，swagger schema 注册顺序留 app）与 `AppMonitorUserSharedService`
 *   （绑定 identity / auth 端口、依赖 app 的 SocketService，是批 6/8 的端口实现
 *   组合根）。数据面 service / repo / entity 在本 lib。
 *
 * 顶层不设聚合 module：app 的 `AppAppModule` 必须把 app 的 `SysDeletedHttpModule`
 * 插在 demo 与 error 之间、把 `AppMonitorUserHttpModule` 插在 cache 与 server 之间，
 * 才能保持 openapi 路径顺序逐字节不变（聚合件会把这两个交错点压平）。
 *
 * 反向依赖底线：本 lib 不 import 任何 `@/`（apps/api/src）路径。
 */
export * from './demo'
export * from './error'
export * from './key'
export * from './logger'
export * from './monitor'
export * from './setting'
export * from './shared'
