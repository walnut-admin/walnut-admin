# tests/journey —— socket / auth / WebAuthn / 权限 / 回收站旅程（E5 / L2 / E5'）

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
- **`force-quit.spec.ts`（J5，E5'）**：管理员重置口令 → 目标浏览器收到 socket `force:quit`
  （seed 策略 `FORCE_IMMEDIATE_SIGNOUT`）→ 自动登出回 `/auth`；旧 AT 40101、两台设备 RT/会话归零、
  新口令可登录。请求体不是断言点：**socket 帧 + DOM 落地**才是（全仓唯一 socket→DOM 通道）。
- **`webauthn.spec.ts`（J6，E5'）**：CDP 虚拟认证器正向注册（`/mfa-required` → `register/verify`）
  → 登出 → 密码登录 `/mfa-verified` → 同一凭据断言（`authenticate/verify`）→ PG 凭据行
  （credentialId / 公钥密文 / counter 递增）。浏览器 origin 是 `http://localhost:<port>`
  （Chrome 拒绝 IP 作 RP ID），后端 RP 口径由 `apps/e2e/scripts/env.ts` 的 `backendEnvOverrides` 注入。
- **`permission-visibility.spec.ts`（J7，E5'）**：菜单给、element 不给（只给 `User` 菜单 +
  `dept:list`）→ `/system/user` 表格挂载但 list 门禁拦请求、表头按钮隐藏；对照 root 全量可见。
  J7b：**不给 `dept:list` 时 `useDeptTree` 降级为空树、页面照常可用**（2026-11-28 修复了
  原来的「40105 未接线 → 全屏致命遮罩」；用例断言不发注定被拒的 dept/tree 请求、点查询仍能
  出无权限提示）。
- **`role-switch.spec.ts`（J8，E5'）**：双角色账号（A=User+user:list，B=Role+role:list）→ 页头下拉
  切 currentRole（`/auth/permissions` 重算）→ 权限串翻转、本设备权限缓存被覆盖、侧边栏/表格/
  按钮随角色变化、旧路由落 404。
- **`deleted-recover.spec.ts`（J9，E5'）**：删用户进 `sys_deleted` → 回收站按快照内容搜到
  （jsonb `content` 的 ILIKE）→ 恢复回业务表 → 再删后真删（`deleteMany`）→ 40401 不可恢复。
- 用例全部带 `@journey` tag（describe 级）；`quarantine.json` 与 `grepInvert` 照常生效。
- `journey-support.ts` 是共享 fixture：一次性账号（`createJourneyUser`）、完整 UI 登录
  （`openLoggedInDevice`）、socket 双通道采集与**带上下文的**事件等待（`captureSocketFrames` /
  `waitForSocketEvent`）。新页面导航一律用 `lib/ui.ts` 的 `navigateToRoute`（`out-in` 过渡防假阴性）。

