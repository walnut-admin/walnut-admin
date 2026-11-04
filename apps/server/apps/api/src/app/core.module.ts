import { Module } from '@nestjs/common'

import { AppErrorModule, AppKeyModule, AppLoggerModule, AppMonitorUserModule, AppSettingsModule } from '@walnut-server/app-domain'
import { SysAuthModule } from '@walnut-server/auth'
import { WalnutConfigModule } from '@walnut-server/config'
import { WalnutModule } from '@walnut-server/db'
import { SysIdentityModule } from '@walnut-server/identity'
// 注意是**子路径**，不是 '@walnut-server/security' barrel —— barrel 里同时导出 cap.service，
// 那会把 new Cap() 重新拉回 worker 的求值闭包（G1 会立刻红）。
import { SecurityRsaModule } from '@walnut-server/rsa'
import { SecurityRiskModule } from '@walnut-server/security/risk/risk.module'
import { SysSystemModule } from '@walnut-server/system'

import { WalnutAdminDataScopePolicyModule } from '@/common/repository/data-scope.policy.module'
import { AppI18nModule } from '@/i18n/i18n.module'
import { AppMonitorUserSharedModule } from '@/modules/app/monitor/user/shared/user.shared.module'
import { SharedModule } from '@/modules/shared/shared.module'
import { SysDeviceKickModule } from '@/modules/system/device/shared/device.kick.module'
import { AppTechCoreModule } from '@/modules/techniques/tech-core.module'
import { SocketCoreModule } from '@/socket/socket-core.module'
import { AppScheduleModule } from './schedule.composition'

/**
 * worker 的组合根 —— 两进程都需要的**业务 / 基础设施**面（R1 §4.2 路线 A）。
 *
 * 边界就一句话：**没有请求管线、没有 HTTP 监听也仍然要跑的东西**。
 * 因此这里不含（每一项都有判据）：
 *
 * | 排除项 | 判据 |
 * |--------|------|
 * | AppMiddlewareModule | Express 中间件，只在 NestApplication.init() 里生效 |
 * | SecurityModule（CAP 宿主） | 4 个 controller；CAP 写路径（challenge/redeem）只在 api |
 * | AppTechModule 的 health / throttler | 一个 /health controller + 请求限流 |
 * | SocketModule（gateway） | 适配器只在 api 装配；worker 用 SocketCoreModule 拿 SocketService |
 * | DiscoveryModule | 只有 swagger 的 bearer 批量注入用它（cli / api） |
 * | 12 条 APP_GUARD + 2 条 APP_INTERCEPTOR | 请求管线专属；**一条都不搬**（拍板 D1） |
 *
 * 与 AppModule 的关系是「**子集**，不是替代」：AppModule 继续是 api + cli 的全量图
 * （apps/cli/src/export-openapi.ts 依赖它，削薄它 = openapi 丢路径），worker 换的是**入口**。
 *
 * 三件容易漏掉的东西（漏了就是启动期 DI 报错，不会静默）：
 * - WalnutAdminDataScopePolicyModule：@Global 端口绑定，基类仓库只认
 *   WALNUT_ADMIN_DATA_SCOPE_POLICY，不 fail-open；
 * - SysDeviceKickModule：@Global 端口绑定，实现注入 SocketService；
 * - AppMonitorUserSharedModule：@Global 端口绑定（IDENTITY_USER_NOTIFIER / AUTH_MONITOR_SERVICE）。
 *
 * 反向的守卫在 apps/api/src/common/monorepo/core-module-scope.drift.spec.ts：
 * 传递闭包与 HTTP-only 集合零交集、且本模块里 APP_GUARD 计数必须为 0。
 */
@Module({
  imports: [
    WalnutConfigModule,
    AppI18nModule,
    WalnutModule,

    // cron 归属：与 api 共用同一判据（WORKER_STANDALONE=true 时 api 让位）
    AppScheduleModule,

    AppTechCoreModule,
    SocketCoreModule,

    // auth 数据面（jwt / refresh / session / signout / otp / google / opaque / mfa / cookie）。
    // app 的 AuthModule 多包一层 AuthHttpModule（9 个 controller + 6 个 passport mixin guard），
    // 那层只在 api。
    SysAuthModule,

    // 封禁踢下线的端口绑定（@Global；实现注入 SocketService）
    SysDeviceKickModule,

    // app 域数据面：error 带 Bull ERROR processor（worker 是消费方）、settings 预热、
    // key 轮换、logger、monitor-user。app 的 AppAppModule 还夹着 demo / deleted / monitor 的
    // controller，那层只在 api。
    AppErrorModule,
    AppMonitorUserModule,
    AppMonitorUserSharedModule,
    AppSettingsModule,
    AppKeyModule,
    AppLoggerModule,

    // system / identity 数据面。app 的 SystemModule 还夹着 SysSystemHttpModule（13 个 controller）
    // 与 SysIdentityHttpModule（9 个），那层只在 api。
    WalnutAdminDataScopePolicyModule,
    SysSystemModule,
    SysIdentityModule,

    // 风控数据面（**不含** SecurityCapModule）：libs/system 的认证日志注入
    // WALNUT_ADMIN_SYSTEM_FAILED_LOGIN_RISK_COLLECTOR，libs/auth 的登出链注入
    // WALNUT_ADMIN_AUTH_RISK_SERVICE —— 两个端口都由本模块 @Global 绑定。
    // 漏了 = worker 启动期 DI 报错（实测：SysLogAuthSharedService 第 4 个参数解析失败）。
    SecurityRiskModule,

    // RSA 服务（@Global）：加解密拦截器的 SecurityRsaService 从这里解析。
    // 密钥材料经 WALNUT_ADMIN_KEY_STORE 端口，由 AppKeyModule（@Global，上面已引）绑定。
    // 漏了 = 任何用了 @WalnutAdminDecoratorCrypto 的 controller 解析失败（实测：SharedAliModule）。
    SecurityRsaModule,

    // ALS（请求上下文 + logger 上下文，@Global）由 SharedModule 带进图 —— D13② 两套 ALS
    // 合一到 `AppALSRequestModule` 后，这里原先单独装的 WalnutContextModule 已无必要。
    SharedModule,
  ],
})
export class AppCoreModule {}
