/**
 * 集成测试专用库名。globalSetup 会 **drop** 这个库 —— 绝对不许改成
 * `walnut-admin-nestjs`（那是迁移用的基准数据），所有用例跑之前都有 fail-fast 守卫。
 */
export const INTEGRATION_DATABASE_NAME = 'walnut-admin-integration'
