/**
 * 构建后资产断言（挂在 `pnpm build` / `pnpm build:stage` 的尾巴上）。
 *
 * 背景：Nest CLI 的 assets manager 用 tsconfig 的 effective rootDir 当 strip root，
 * 而 SWC 产物布局由 `outDir + sourceRoot` 决定 —— 两者一旦不一致，i18n / public / views
 * 会被静默拷到 `dist/apps/api/src/apps/server/apps/api/src/...` 这类错误目录。
 * 2026-10 的实际后果：API 启动与业务路由都「看起来正常」（异常过滤器把 ENOENT 兜成
 * HTTP 200 + body code=50000，compose healthcheck 也不校验响应体），缺陷只会以 ERROR
 * 日志与缺失的邮件模板 / i18n 文案暴露 —— 因此必须在构建期红，不能拖到运行期才发现。
 *
 * 用法（在 apps/server 下）：node infra/scripts/verify-build-assets.ts <dist 根目录>
 *   pnpm build       -> ... && node infra/scripts/verify-build-assets.ts dist
 *   pnpm build:stage -> ... && node infra/scripts/verify-build-assets.ts dist-stage
 *
 * Node 24 原生类型剥离执行（仓库禁 .mjs / .cjs）。检查逻辑抽成 checkAssets 便于单测
 * （apps/api/src/common/monorepo/verify-build-assets.spec.ts）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/** 运行期/部署探针真正依赖的资产；新增必须随产物落盘的资源时同步这里。 */
export const REQUIRED_ASSETS = [
  // 静态资源（FaviconMiddleware / deploy compose 的 healthcheck 探针）
  'apps/api/src/public/favicon.ico',
  'apps/api/src/public/images/demo.png',
  // nestjs-i18n 的 JSON loader 目录（<产物>/apps/api/src/i18n）
  'apps/api/src/i18n/en_US/index.json',
  // 邮件模板（libs/mailer 从产物根回溯 apps/api/src/views）
  'apps/api/src/views/template/mailer/welcome.hbs',
] as const

/** 返回 distRoot 下缺失的必需资产清单（空数组 = 全部就位）。 */
export function checkAssets(distRoot: string): string[] {
  return REQUIRED_ASSETS.filter(asset => !existsSync(join(distRoot, asset)))
}

function main(): void {
  const distRoot = process.argv[2]

  if (distRoot === undefined || distRoot === '') {
    console.error('[verify-build-assets] 缺少参数：dist 根目录（如 dist / dist-stage）')
    process.exit(1)
  }

  const missing = checkAssets(distRoot)

  if (missing.length > 0) {
    console.error(`[verify-build-assets] ${distRoot} 缺少 ${missing.length} 个必需资产：`)
    for (const asset of missing) {
      console.error(`  - ${asset}`)
    }
    console.error('[verify-build-assets] 多半是 Nest CLI assets 的 strip root 与 outDir 不再匹配；见 infra/README.md「静态资源处理」')
    process.exit(1)
  }

  console.log(`[verify-build-assets] ${distRoot} 资产校验通过（${REQUIRED_ASSETS.length} 项）`)
}

// 直跑守卫：被 spec import 时不执行（server tsconfig 是 module=commonjs，import.meta
// 过不了 tsc，故用 argv 入口名判断；改名文件需同步这里）
if ((process.argv[1] ?? '').endsWith('verify-build-assets.ts')) {
  main()
}
