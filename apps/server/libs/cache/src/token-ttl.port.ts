/**
 * Token TTL 端口（libs 解耦批 2 的依赖反转）。
 *
 * cache 的 mfa / permissions / sign 三个领域服务只需要「AT/RT 过期秒数」，此前直接
 * import app 的 AppTokenService（lib → app 反向依赖，libs 边界 lint 的存量疤）。
 * 现在 lib 只依赖本端口，实现随 token 基础设施落 `libs/token`，由该 lib 的
 * `AppTokenModule`（@Global）用
 * `{ provide: WALNUT_ADMIN_TOKEN_TTL, useExisting: AppTokenService }` 绑定 ——
 * AppTokenService 的两个 getter 在结构上天然满足。
 */
export const WALNUT_ADMIN_TOKEN_TTL = Symbol('WALNUT_ADMIN_TOKEN_TTL')

export interface IWalnutAdminTokenTtl {
  getAccessTokenExpireSeconds: () => number
  getRefreshTokenExpireSeconds: () => number
}
