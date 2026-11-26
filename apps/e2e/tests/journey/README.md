# tests/journey —— socket / auth / 锁屏旅程（E5 / L2）

这个目录是 Playwright project `journey` 的用例落点，**profile 与 project 同名**：
`E2E_STACK_PROFILE=journey`（库 `walnut_e2e_journey`、后端 / socket / 静态代理 3105 / 3015 / 4185、
基线 `.e2e/journey/`）。profile 表是 `apps/e2e/scripts/stack-profiles.ts`；跑别的 project 会被
`apps/e2e/scripts/run.ts` 在动锁 / 动库之前拒绝（退出码 2）。

- 跑法：`E2E_STACK_PROFILE=journey pnpm walnut e2e --project=journey`（CI 的 `e2e (journey)` job 同一条）。
- project 依赖 `auth-setup → stack-setup`：`stack.setup` 把 admin 的 TOTP 真实绑定并写
  `.auth/credentials.json`，`auth.setup` 验证 UI 登录链路。**不产出可复用 storageState**
  （不变量 7）：每条用例仍各自走 UI / 协议登录。
- **`lock.spec.ts`（L2，2026-11-27）**：锁屏闭环 J1–J4，一次性账号 + 每设备独立 IP：
  - J1：security 模式设置（网络层断言 `lockPwdHash` 是 AES-GCM 信封）→ `/lock` 密码框 →
    5 次失败进入 30s 退避（按 DB 时钟等待）→ 正确密码解锁（socket `lock:unlock` + PG/Redis 断言）；
  - J2：忘记锁屏密码 → OPAQUE 登录口令 fallback；错口令在客户端即失败、服务端不计次；
    40115 经 `/mfa-verified` 回到 `/lock`（D3 回归）；
  - J3：root 在用户管理行内重置被锁用户 → `sys_user_device.locked=false` + `user.lock.reset` 审计行；
  - J4：登录即解锁，`lockCrossDevice=true` 全解 / `false` 只解本台（纯协议，两态都钉）。
- 用例全部带 `@journey` tag（describe 级）；`quarantine.json` 与 `grepInvert` 照常生效。
