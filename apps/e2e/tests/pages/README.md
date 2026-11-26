# tests/pages —— admin 页面扩面（E4）

这个目录是 Playwright project `pages` 的用例落点，**profile 与 project 同名**：
`E2E_STACK_PROFILE=pages`（库 `walnut_e2e_pages`、后端 / socket / 静态代理 3104 / 3014 / 4184、
基线 `.e2e/pages/`）。profile 表是 `apps/e2e/scripts/stack-profiles.ts`；跑别的 project 会被
`apps/e2e/scripts/run.ts` 在动锁 / 动库之前拒绝（退出码 2）。

- 跑法：`E2E_STACK_PROFILE=pages pnpm walnut e2e --project=pages`（CI 的 `e2e (pages)` job 同一条）。
  首跑（或基线 dataKey 漂移）加 `--rebuild-baseline` 全量 prepare + seal。
- **E4 已落地**：`reachability.spec.ts` 覆盖调研报告的 **18 个侧边栏业务页**，按路由结构分成
  6 条页面链（静态入口 / system 用户域 / system 字典与国际化 / system 设备与审计 / app 域 /
  demo 抽样）。每页断言三层：URL 无重定向、组件挂载（布局内容容器 `#<route.name>-content`
  有元素子节点）、首屏主数据 `20000`（user/role/deleted 三张表顺带断言 E1 落地的表格 testid）。
  登录只做一次：整个文件是一个 worker，用例复用 worker 级共享只读 context（`authedPage`）。
- **已知 seed 漂移**：`/demo/table/base` 的 `component = demo/table/baseTable` 没有对应文件
  （`views/demo/table/` 只有 `index.vue` / `useTable.vue`，git 历史也从未有过 `baseTable.vue`）。
  语义不明（该指向 `useTable` 还是 `index`），本批不改 seed —— 用 `test.fixme` 留下可执行的
  复现；补上组件或修正 seed 后删掉 `.fixme` 即转绿。
- 本 project 依赖 `auth-setup`（→ `stack-setup`）：`auth.setup` 负责「admin 凭据能过完整 UI
  登录」的门禁与 TOTP secret 写入，**不产出可复用的 storageState**（不变量 7）；页面用例
  仍复用 worker 内存里的登录 context。
