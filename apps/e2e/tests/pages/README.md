# tests/pages —— admin 页面扩面（E4）

这个目录是 Playwright project `pages` 的用例落点，**profile 与 project 同名**：
`E2E_STACK_PROFILE=pages`（库 `walnut_e2e_pages`、后端 / socket / 静态代理 3104 / 3014 / 4184、
基线 `.e2e/pages/`）。profile 表是 `apps/e2e/scripts/stack-profiles.ts`；跑别的 project 会被
`apps/e2e/scripts/run.ts` 在动锁 / 动库之前拒绝（退出码 2）。

- 跑法：`E2E_STACK_PROFILE=pages pnpm walnut e2e --project=pages`（CI 的 `e2e (pages)` job 同一条）。
- **本批（E3）只建目录，spec 由 E4 落地。** 空目录下 Playwright 以「No tests found」退出非零 ——
  这是**诚实状态**：E4 落地前 CI 的 pages job 预期红，别用 `test.skip` / 占位空文件把它洗成绿。
- 本 project 暂时**不挂** setup 依赖：空 project 一旦挂了 `auth-setup`，Playwright 会跑完依赖
  用例并返回 0（假绿）。E4 落 spec 时按需补 `dependencies: ['auth-setup']`（页面渲染断言需要
  已登录会话；`auth.setup` 不产出可复用 storageState —— 不变量 7）。
