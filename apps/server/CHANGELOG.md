# @walnut/server

## 0.1.0

### 新功能

- [`b63ec42`](https://github.com/walnut-admin/walnut-admin/commit/b63ec42ad270db58522cf0d1385a432fb94b4175) by @Zhaocl1997 three-repo monorepo merge — Phase 1 complete
- [`5c8fbd8`](https://github.com/walnut-admin/walnut-admin/commit/5c8fbd8eb9f49c7265103d2e5eab2b3ca7046c76) by @Zhaocl1997 **contract** create @walnut/contract, consolidate shared types/constants across frontend and backend
- [`b4db0d2`](https://github.com/walnut-admin/walnut-admin/commit/b4db0d2b34015e55e6dda6a04b88ebdc66a718f9) by @Zhaocl1997 dotenvx encrypted env management + staging->stage unification
- [`f00f980`](https://github.com/walnut-admin/walnut-admin/commit/f00f98089af3800384f85cac38802a16842bc20e) by @Zhaocl1997 add turbo boundaries with tag-based architecture enforcement
- [`baf5207`](https://github.com/walnut-admin/walnut-admin/commit/baf52075dc83dd36d146cf16df76998f98509ab6) by @Zhaocl1997 selective barrel exports for all packages, add ADR 0013
- [`10e2a7a`](https://github.com/walnut-admin/walnut-admin/commit/10e2a7ad82cb181b13c26cdca3b095f7efcd0f91) by @Zhaocl1997 migrate token types to contract, add API route constants (Batch 2)
- [`04130cf`](https://github.com/walnut-admin/walnut-admin/commit/04130cf295d6bb7acfbade28b4becb5097859f48) by @Zhaocl1997 Step 2.1 — add socket/cookie/token/AES-GCM constants to contract, de-duplicate across FE/BE
- [`8f29a8b`](https://github.com/walnut-admin/walnut-admin/commit/8f29a8bac705aa86e7d840c5ad467d524e2e9cf9) by @Zhaocl1997 Phase 2 steps 2.3+2.5 — pagination type doc, server consts to contract re-exports
- [`a0e2575`](https://github.com/walnut-admin/walnut-admin/commit/a0e2575c76c9b83f14bfaa3434b0d8403235e1c9) by @Zhaocl1997 **docker** add multi-stage Dockerfile for @walnut/server
- [`599622d`](https://github.com/walnut-admin/walnut-admin/commit/599622d0954cc6051c2bf79c38bbaba624211475) by @Zhaocl1997 **deploy** add docker-compose orchestration with nginx entry (brotli, internal network)
- [`64512cc`](https://github.com/walnut-admin/walnut-admin/commit/64512cc754ca6d3af00f71b782615ebeca9a9f0e) by @Zhaocl1997 **tooling** 文档门禁扩到 markdown 链接 + R11 收尾（又抓出 17 类真失效）
- [`ca07d53`](https://github.com/walnut-admin/walnut-admin/commit/ca07d532bb10416e41e200eed4a5922c36831134) by @Zhaocl1997 **tooling** 新增共享测试预设 @walnut/vitest-config（第 6 个 tooling 包，P3-14）
- [`f70d9e5`](https://github.com/walnut-admin/walnut-admin/commit/f70d9e5ac6f29113e5acd8b70c5d21322f74fca7) by @Zhaocl1997 **tooling** 别名门禁扩到 apps/server/libs 下的文档（P2-22）
- [`f0f2636`](https://github.com/walnut-admin/walnut-admin/commit/f0f2636d86b7c7d1783bba4ab241bcbb316348de) by @Zhaocl1997 **tooling** 新增本地规则「注释里不许有 emoji」+ 全仓清理存量
- [`4215de0`](https://github.com/walnut-admin/walnut-admin/commit/4215de07ee119fbdc9716b7bff761e1ff1035c96) by @Zhaocl1997 **server** 初始化数据（seed）进仓，并留下「哪些刻意不进」的判据
- [`71c8b7c`](https://github.com/walnut-admin/walnut-admin/commit/71c8b7c5e3f07445daba8045bbf858a9e9ce0b7f) by @Zhaocl1997 **tooling** 新增 `pnpm db:seed` —— 初始化数据播种（幂等；app_key 现生成）
- [`8db6801`](https://github.com/walnut-admin/walnut-admin/commit/8db680112af00935ebaf09c43b82c259d1294237) by @Zhaocl1997 **tooling** 新增 `pnpm db:export` + `--with-areas`（seed 数据从此"可再生成"）
- [`7426bfc`](https://github.com/walnut-admin/walnut-admin/commit/7426bfcf4d0068c4fb97feda2e446418231c3192) by @Zhaocl1997 **tooling** 新增 `pnpm lint:emoji` —— 注释里不许有 emoji（跨所有被跟踪文本文件）+ 常驻文档去 emoji

### 修复

- [`576964d`](https://github.com/walnut-admin/walnut-admin/commit/576964d1002b07c33237adda15e1b1251964f851) by @Zhaocl1997 **eslint** move @antfu/eslint-config to catalog, declare in all consumers
- [`7026428`](https://github.com/walnut-admin/walnut-admin/commit/7026428e534ddf55503b9520e7573737e58a0bb0) by @Zhaocl1997 add VITE_* env tracking to turbo.json, document toolchain divergence as ADR 0012
- [`269b88a`](https://github.com/walnut-admin/walnut-admin/commit/269b88a86f8db660f1da315e8e601e5a5a755ff5) by @Zhaocl1997 resolve remaining type errors after contract consolidation
- [`99e6170`](https://github.com/walnut-admin/walnut-admin/commit/99e6170d7d6c96676456a87b479bea1b3570aacb) by @Zhaocl1997 resolve remaining lint/boundary issues, update ADR docs
- [`bcbc357`](https://github.com/walnut-admin/walnut-admin/commit/bcbc357fbf9c376a62e15d2250c71956226c05e1) by @Zhaocl1997 **server** lint fix
- [`7e4b858`](https://github.com/walnut-admin/walnut-admin/commit/7e4b85889cfa33d7183ad0a28eb8d67ca336227f) by @Zhaocl1997 **server** align prod build with monorepo layout (swcrc minify, app name, Docker CMD)
- [`134f057`](https://github.com/walnut-admin/walnut-admin/commit/134f0577fe9f4779b7f9ed1679b40aceb771f8ce) by @Zhaocl1997 **admin** enable brotli precompression, fix server prod paths, update env docs
- [`fd875a2`](https://github.com/walnut-admin/walnut-admin/commit/fd875a281275ec69ca9c79de48f80358e9f43b87) by @Zhaocl1997 **docker** pnpm deploy with --legacy flag (no inject-workspace-packages)
- [`2b8fbda`](https://github.com/walnut-admin/walnut-admin/commit/2b8fbdaa69c6f4dae5d5a65ca9f03d725084f4de) by @Zhaocl1997 **server** 补全 production/stage 缺失的 USER_ID 加密密钥
- [`d0ac65b`](https://github.com/walnut-admin/walnut-admin/commit/d0ac65b0a0702d67ea71955930bffbdd52aedb5f) by @Zhaocl1997 **server** 清理 jest 残留依赖并修复 vitest 测试链路
- [`b6ac29a`](https://github.com/walnut-admin/walnut-admin/commit/b6ac29ae4abc0e0339725814efefed0c61a59fb2) by @Zhaocl1997 **server** setup-env 纳入基础 .env 加密，修复 CI 构建缺变量
- [`6fdd679`](https://github.com/walnut-admin/walnut-admin/commit/6fdd6795811a2874777de4d6652e86fb72fdc864) by @Zhaocl1997 **server** staging 构建落到独立的 dist-stage（P3-22）
- [`d4089e3`](https://github.com/walnut-admin/walnut-admin/commit/d4089e3254de4b0379cd8446a467ae641cc74932) by @Zhaocl1997 **tooling** lint 的 --concurrency=auto 换成固定 4（12 worker 偶发 0xC0000005）

### 性能

- [`6ad21c7`](https://github.com/walnut-admin/walnut-admin/commit/6ad21c7a865396dbefdc4591a70ec9eb38976afa) by @Zhaocl1997 **deploy** docker 构建接入 buildx gha 缓存，依赖安装层跨运行命中

### 重构

- [`609722b`](https://github.com/walnut-admin/walnut-admin/commit/609722b0c5e1c8ca51d8dd9f7e999c911b193ac9) by @Zhaocl1997 **server** rename @walnut/* lib aliases to @walnut-server/*
- [`5b60b02`](https://github.com/walnut-admin/walnut-admin/commit/5b60b0257095260a47ed78abf5139eaca9c3c188) by @Zhaocl1997 **skills** 整合 skill 到 .claude/skills/，中文化并精简为约束型
- [`bfa000d`](https://github.com/walnut-admin/walnut-admin/commit/bfa000d6185048cabf01a5f83295b6b4291db15f) by @Zhaocl1997 **packages** restructure monorepo packages — honest naming, clean separation
- [`94ee4c7`](https://github.com/walnut-admin/walnut-admin/commit/94ee4c7050147e9046ed00f1c2e548080fb9674d) by @Zhaocl1997 **server** extract shared tsconfig.lib.base.json, remove tsconfig.schema.json
- [`c1f2c8a`](https://github.com/walnut-admin/walnut-admin/commit/c1f2c8adef9cecc129fc9020dd82010efbd433f2) by @Zhaocl1997 **lint** extract shared @walnut/eslint-config package, add curated barrel exports
- [`862bb0f`](https://github.com/walnut-admin/walnut-admin/commit/862bb0f24b472dac92c2ba42955f3e70ae8c60d1) by @Zhaocl1997 remove cross-package tsconfig paths, clean unnecessary devDependencies
- [`dd7a25c`](https://github.com/walnut-admin/walnut-admin/commit/dd7a25c8fd1cf112269ea1490112b3d86178b126) by @Zhaocl1997 direct contract consumption — remove server wrapper layers and admin indirect imports
- [`2f8cb86`](https://github.com/walnut-admin/walnut-admin/commit/2f8cb86e9a946ae92b5d7fd08f556091b581f9f2) by @Zhaocl1997 **release** 接入 changelog-github per-package CHANGELOG，移除 git-cliff 并统一 repository
- [`1dc9e10`](https://github.com/walnut-admin/walnut-admin/commit/1dc9e100e6331e709a99d99c9aac3a13295950c8) by @Zhaocl1997 **server** remove env template dirs, keep env-encrypted (comments as template) + env-local
- [`80cc7f0`](https://github.com/walnut-admin/walnut-admin/commit/80cc7f00140d2ac3e002699b0e1b24dc411109f6) by @Zhaocl1997 **server** 事务拦截器改用 @InjectConnection 注入
