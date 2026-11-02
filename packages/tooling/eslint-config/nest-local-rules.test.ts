/**
 * `nest-local-rules.ts` 的 `no-cross-lib-relative-import` 用例（RuleTester 正反语料）。
 *
 * 重点在边界：lib 内部的 `./` / `../`（含跨目录但仍在同一 lib 根）必须放行，
 * 只有解析后逃出 `libs/<name>/` 才报；`libs/` 之外的文件（apps/**）完全不管。
 * import 与 re-export（`export ... from` / `export * from`）走同一判定函数。
 *
 * RuleTester 不能指定 `context.cwd`（恒为 process.cwd()，即本包根），因此 filename 都用
 * 相对本包根的 `libs/...` 形态；另有一条 Windows 反斜杠 filename 验证分隔符归一。
 */
import { resolve } from 'node:path'
import { RuleTester } from 'eslint'
import { describe, expect, it } from 'vitest'
import localRules, { resolveLibRoot } from './nest-local-rules.ts'

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

const libRootOf = (name: string): string => resolve(process.cwd(), 'libs', name).replace(/\\/g, '/')

/** cwd 相对的 filename（RuleTester 的 context.cwd 就是本包根） */
const LIB_SERVICE = 'libs/system/src/role/role.service.ts'
const LIB_INDEX = 'libs/system/src/index.ts'

/** Windows 反斜杠 filename：用本机 cwd 拼，规则先 toPosixPath 再 resolve，Linux 上同样可测 */
const LIB_SERVICE_BACKSLASH = resolve(process.cwd(), LIB_SERVICE).replace(/\//g, '\\')

describe('no-cross-lib-relative-import —— lib 内相对路径禁止跨 lib 逃逸', () => {
  it('正反语料（import + re-export）', () => {
    tester.run('no-cross-lib-relative-import', localRules.rules['no-cross-lib-relative-import'], {
      valid: [
        // 同目录 / 同 lib 内跨目录
        { code: 'import { roleConst } from \'./role.const\'', filename: LIB_SERVICE },
        { code: 'import { shared } from \'../shared/role.shared\'', filename: LIB_SERVICE },
        { code: 'import { root } from \'../../system.module\'', filename: LIB_SERVICE },
        // ../../ 从 role/ 只到 libs/system，仍是同一 lib（判定按「是否逃出 lib 根」，不按段数）
        { code: 'import { x } from \'../../identity/src/index\'', filename: LIB_SERVICE },
        // re-export 同一判定：lib 内部的相对 re-export 放行
        { code: 'export * from \'./role.const\'', filename: LIB_SERVICE },
        { code: 'export { roleConst } from \'../shared/role.shared\'', filename: LIB_SERVICE },
        { code: 'export { IRole } from \'./role.types\'', filename: LIB_SERVICE },
        // 无 source 的 export 不适用（source 缺省 / null）
        { code: 'const value = 1\nexport { value }', filename: LIB_SERVICE },
        // 非相对路径：别名 / 裸包 / 绝对路径形态都不归本规则管
        { code: 'import { x } from \'@walnut-server/identity\'', filename: LIB_SERVICE },
        { code: 'export * from \'@walnut-server/identity\'', filename: LIB_SERVICE },
        { code: 'import { x } from \'@/app/app.module\'', filename: LIB_SERVICE },
        { code: 'import { x } from \'lodash\'', filename: LIB_SERVICE },
        { code: 'export { x } from \'lodash\'', filename: LIB_SERVICE },
        // Windows 反斜杠 filename（分隔符归一后仍是 lib 内相对路径）
        { code: 'import { roleConst } from \'./role.const\'', filename: LIB_SERVICE_BACKSLASH },
        // libs/ 之外（apps/**）不适用
        { code: 'import { x } from \'../../libs/identity/src/index\'', filename: 'apps/api/src/app.module.ts' },
        // 相对路径里带 libs/ 字样但不在 <cwd>/libs 下（如 apps/server/libs/...）也不适用
        { code: 'import { x } from \'../../libs/identity/src/index\'', filename: 'apps/server/libs/system/src/index.ts' },
      ],
      invalid: [
        {
          code: 'import { x } from \'../../identity/src/index\'',
          filename: LIB_INDEX,
          errors: [{ messageId: 'crossLib' }],
        },
        // re-export：具名 / 全量 / 命名空间三种形态都必须报
        {
          code: 'export { x } from \'../../identity/src/index\'',
          filename: LIB_INDEX,
          errors: [{ messageId: 'crossLib' }],
        },
        {
          code: 'export * from \'../../identity/src/index\'',
          filename: LIB_INDEX,
          errors: [{ messageId: 'crossLib' }],
        },
        {
          code: 'export * as identity from \'../../identity/src/index\'',
          filename: LIB_INDEX,
          errors: [{ messageId: 'crossLib' }],
        },
        {
          code: 'export { x } from \'../../../apps/api/src/app.module\'',
          filename: LIB_INDEX,
          errors: [{ messageId: 'crossLib' }],
        },
        // 已逃出仓库更高层目录也算（规则只关心「是否还在当前 lib 根内」）
        {
          code: 'import { x } from \'../../../../outside/index\'',
          filename: LIB_SERVICE,
          errors: [{ messageId: 'crossLib' }],
        },
        // Windows 反斜杠 filename 同样生效
        {
          code: 'export * from \'../../../../outside/index\'',
          filename: LIB_SERVICE_BACKSLASH,
          errors: [{ messageId: 'crossLib' }],
        },
      ],
    })
  })
})

describe('resolveLibRoot —— lib 根推导锚定 <cwd>/libs', () => {
  it('cwd 相对 filename 归一到 <cwd>/libs/<name>', () => {
    expect(resolveLibRoot(process.cwd(), LIB_INDEX)).toBe(libRootOf('system'))
  })

  it('反斜杠 filename（Windows 形态）归一后同样命中', () => {
    expect(resolveLibRoot(process.cwd(), LIB_SERVICE_BACKSLASH)).toBe(libRootOf('system'))
  })

  it('检出目录的祖先含 libs/<name> 时不把祖先当 lib 根（旧实现会 fail-open）', () => {
    // cwd 本身位于 `libs/checkout/` 之下：旧实现在整条路径里找第一个 `libs/<name>/`，
    // 会把 `<pkg>/libs/checkout` 误认成 lib 根，从而放过所有逃逸边
    const cwd = resolve(process.cwd(), 'libs/checkout/apps/server')
    expect(resolveLibRoot(cwd, resolve(cwd, 'libs/identity/src/index.ts')))
      .toBe(resolve(cwd, 'libs/identity').replace(/\\/g, '/'))
  })

  it('libs/ 之外返回 null', () => {
    expect(resolveLibRoot(process.cwd(), 'apps/api/src/app.module.ts')).toBeNull()
    // 路径里带 libs/ 字样但不以 <cwd>/libs/ 开头：不归本规则管
    expect(resolveLibRoot(process.cwd(), 'apps/server/libs/system/src/index.ts')).toBeNull()
  })
})
