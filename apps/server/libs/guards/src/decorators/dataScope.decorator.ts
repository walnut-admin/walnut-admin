import { SetMetadata } from '@nestjs/common'

/**
 * 数据权限三期：**系统通道**标记（RLS 维度）。
 *
 * 语义与 `ALSRequestService.runAsSystem()` 同层：该处理器在拿到登录用户之前就要读写
 * 已注册业务表（典型是登录链：按用户名查 sys_user、写 sys_log_auth；在线监控心跳写
 * app_monitor_user）。这些读腿本来就在应用层 scope 之外（repo service 系统通道），
 * RLS 若按匿名 fail-closed 处理会把登录/心跳打断。
 *
 * 标记后：无 ALS 描述的请求 → RLS 模式 `system`（策略放行）。
 * **已登录请求不降级**：ALS 有描述符时仍按描述符下发 `all` / `scoped`，
 * 标记只影响「本来就没有描述符」的处理器。
 */
export const WALNUT_DATA_SCOPE_SYSTEM_CHANNEL_METADATA_KEY = 'walnut:data-scope:system-channel'

export function WalnutAdminDecoratorDataScopeSystemChannel() {
  return SetMetadata(WALNUT_DATA_SCOPE_SYSTEM_CHANNEL_METADATA_KEY, true)
}
