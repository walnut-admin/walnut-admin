# tests/journey —— socket / auth / 锁屏旅程扩面（E5）

这个目录是 Playwright project `journey` 的用例落点，**profile 与 project 同名**：
`E2E_STACK_PROFILE=journey`（库 `walnut_e2e_journey`、后端 / socket / 静态代理 3105 / 3015 / 4185、
基线 `.e2e/journey/`）。profile 表是 `apps/e2e/scripts/stack-profiles.ts`；跑别的 project 会被
`apps/e2e/scripts/run.ts` 在动锁 / 动库之前拒绝（退出码 2）。

- 跑法：`E2E_STACK_PROFILE=journey pnpm walnut e2e --project=journey`（CI 的 `e2e (journey)` job 同一条）。
- **本批（E3）只建目录，spec 由 E5 落地。** 空目录下 Playwright 以「No tests found」退出非零 ——
  这是**诚实状态**：E5 落地前 CI 的 journey job 预期红，别用 `test.skip` / 占位空文件把它洗成绿。
- 本 project 暂时**不挂** setup 依赖（空 project 挂了 `auth-setup` 会因依赖用例假绿）；E5 落
  spec 时按需补 `dependencies`（不产出可复用 storageState —— 不变量 7）。
