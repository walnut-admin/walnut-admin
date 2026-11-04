import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * D11 的结构性回归守卫：**murlock 只能出现在 `libs/lock` 内部**。
 *
 * 背景：端口化之前有 10 处 `import { MurLockService } from 'murlock'` 散在
 * guards / security / app-domain —— 「换一把锁要改 10 个文件」。端口化之后这句话
 * 只能靠**门禁**维持，不能靠 review：新增一处直连在类型、lint、单测里都是绿的。
 *
 * 四条断言：
 * 1. 全仓真正的 murlock import 只落在 `libs/lock/`；
 * 2. `libs/lock` 内部也只有两个触碰点（适配器 + 模块），防止第三个文件悄悄进来；
 * 3. 注入 Symbol token 的地方必须带 `@Inject(WALNUT_ADMIN_LOCK)` —— Symbol 不是类，
 *    漏了装饰器 Nest 解析不出 provider，运行时才炸（类型系统看不见）；
 * 4. 消费方清单就是 D11 的迁移面（10 处），漏改一处会以「还在用 vendor」的形式留着。
 *
 * 扫描范围与 cwd 的口径同 `lib-registration.drift.spec.ts`：`pnpm --filter @walnut/server test`
 * 的 cwd 是 `apps/server`。
 */

const SERVER_ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'logs', 'coverage', 'env-local', 'env-encrypted', 'public'])
const LOCK_SRC = resolve(SERVER_ROOT, 'libs', 'lock', 'src')
const LOCK_LIB_PREFIX = relative(SERVER_ROOT, resolve(SERVER_ROOT, 'libs', 'lock')) + sep

/**
 * 真正的 vendor import（`import ... from 'murlock'` / `import 'murlock'` / `export ... from`）。
 * 按**行首锚定**，这样注释里引用的字样（端口与本文件都在解释规则）不算命中；
 * `murlock/x` 这类子路径不算。
 */
const MURLOCK_IMPORT_RE = /^[ \t]*(?:import|export)\s[^\n]*\sfrom\s+['"]murlock['"]|^[ \t]*import\s+['"]murlock['"]/m

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walkTsFiles(full, out)
      }
      continue
    }
    if (entry.isFile() && full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

const allFiles = walkTsFiles(SERVER_ROOT)
const rel = (file: string) => relative(SERVER_ROOT, file).split(sep).join('/')
const isInsideLockLib = (file: string) => relative(SERVER_ROOT, file).startsWith(LOCK_LIB_PREFIX)
const textOf = (file: string) => readFileSync(file, 'utf8')

describe('d11 锁端口化：murlock 被收在 libs/lock 内部', () => {
  it('真正的 vendor import 只落在 libs/lock（新代码直连会让这条红）', () => {
    const offenders = allFiles
      .filter(file => !isInsideLockLib(file))
      .filter(file => MURLOCK_IMPORT_RE.test(textOf(file)))
      .map(rel)

    expect(offenders).toEqual([])
  })

  it('libs/lock 内部的触碰点恰好两个：适配器（MurLockService）与模块（MurLockModule）', () => {
    const vendorTouches = allFiles
      .filter(isInsideLockLib)
      .filter(file => MURLOCK_IMPORT_RE.test(textOf(file)))
      .map(file => relative(LOCK_SRC, file).split(sep).join('/'))
      .sort()

    expect(vendorTouches).toEqual(['lock.module.ts', 'murlock.adapter.ts'])
  })

  it('注入 WALNUT_ADMIN_LOCK 的地方都带 @Inject(...)：Symbol token 漏装饰器只在运行时炸', () => {
    const missingInject = allFiles
      .filter(file => !isInsideLockLib(file))
      .filter((file) => {
        const text = textOf(file)
        if (!/constructor\s*\(/.test(text) || !/WALNUT_ADMIN_LOCK\s*[,)]/.test(text)) {
          return false
        }
        return !/@Inject\(\s*WALNUT_ADMIN_LOCK\s*\)/.test(text)
      })
      .map(rel)

    expect(missingInject).toEqual([])
  })

  it('消费方清单是 10 处（D11 的迁移面）', () => {
    const consumers = allFiles
      .filter(file => !isInsideLockLib(file))
      .filter(file => /@Inject\(\s*WALNUT_ADMIN_LOCK\s*\)/.test(textOf(file)))
      .map(rel)
      .sort()

    expect(consumers).toEqual([
      'libs/app-domain/src/shared/area/area.service.ts',
      'libs/guards/src/guards/cap.guard.ts',
      'libs/guards/src/guards/device.guard.ts',
      'libs/guards/src/guards/lock.guard.ts',
      'libs/guards/src/guards/sign.guard.ts',
      'libs/security/src/risk/modules/device.service.ts',
      'libs/security/src/risk/modules/failedLogin.service.ts',
      'libs/security/src/risk/modules/location.service.ts',
      'libs/security/src/risk/modules/user.service.ts',
      'libs/security/src/risk/modules/user_device.service.ts',
    ])
  })
})
