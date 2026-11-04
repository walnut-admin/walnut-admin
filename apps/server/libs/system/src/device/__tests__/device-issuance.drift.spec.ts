import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 设备身份签发的结构性回归守卫（14-D 的删除面 + 14-A 注释里那两条事实的机械钉子）。
 *
 * 背景：14-A 把「设备身份是怎么来的」这段叙述从「对指纹做 HMAC」改成了「服务端随机签发」，
 * 并把签发点的说法从「两处」改成了「只有一处」。**注释里的数字与函数名都会腐烂**
 * （本仓纪律 11：不写会腐烂的计数，要写判据），所以把这两条事实从散文搬到门禁上 ——
 * 注释说「1 处」，这里数给它看。
 *
 * 三条断言（任一被破坏则红）：
 * 1. 生产源码里 `generateDeviceId(...)` 的**调用点恰好 1 处**，且在 device.service.ts。
 *    多一处签发腿 = 「谁能决定一个设备身份」多一条面要单独审计（B5 之前这条面在客户端）；
 * 2. 指纹派生的两个函数名（`getDeviceIdByFingerprint` / `hashDeviceFingerprint`）在
 *    生产源码里**连提都不许提** —— 它们已在 14-D 整段删除；「恢复」它们等于把
 *    「身份 = f(客户端自报值)」这条已废弃的等式请回来（连注释都不留，免得下一个读的人
 *    以为它还在）；
 * 3. `DEVICE_ID_ENCRYPTION_KEY` 已于 2026-11-04 **退役**（env / 密文 / 必填校验 / 类型声明 /
 *    命名空间注册同一批删干净），所以它的**代码读者集合必须为空**。它的历史用途只是单向
 *    HMAC 盐（从没加密过任何数据），B5 起 device_id 由服务端随机签发 ⇒ 0 个消费者；
 *    改造前后的来龙去脉留在 device-id.ts 的注释里，不留在配置骨架里。谁再把这个 env
 *    读回来（哪怕是「兼容」），这里红。
 *
 * 扫描口径同 `libs/lock/src/murlock-isolation.drift.spec.ts` / `lib-registration.drift.spec.ts`：
 * `pnpm --filter @walnut/server test` 的 cwd 是 `apps/server`，所以以 process.cwd() 为根。
 */

const SERVER_ROOT = process.cwd()
const SCAN_DIRS = ['apps/api', 'libs']
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-stage', '.git', 'logs', 'coverage', 'env-local', 'env-encrypted', 'public'])
/**
 * 测试树按**目录**排除，不能只靠后缀：`'x.api-spec.ts'.endsWith('.spec.ts')` 是 **false**，
 * 只按后缀排除的话 `apps/api/test/` 下的 api-spec 会被当成生产源码 —— 今天它们没调
 * `generateDeviceId`，所以是绿的；但只要哪天有一份 api-spec 调了它，「调用点恰好 1 处」
 * 就会**假红**（绿的时候看不出这套口径是错的）。
 */
const TEST_DIR_PREFIXES = ['apps/api/test/']
/** 后缀判定留着兜那些散在源码目录里的单测（`libs/` 与 `apps/api/src/` 各自的 `*.spec.ts`） */
const TEST_SUFFIXES = ['.spec.ts', '.int-spec.ts', '.e2e-spec.ts']
/** 迁移里的 SQL 是独立一份（CHECK 正则故意复制），不参与身份腿的计数 */
const EXCLUDED_PREFIXES = ['apps/api/migrations/']

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
    if (entry.isFile() && full.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * 把注释**内容**抹成空格（长度不变，行号仍对得上；字符串字面量跳过，免得
 * `'https://…'` 里的 `//` 被当成注释起点）。
 *
 * 为什么必须抹：改造之后 device-id.ts 自己的 JSDoc 里就写着
 * `isValidDeviceId(cookieDeviceId) ? cookieDeviceId : generateDeviceId()` ——
 * 按字样 grep 会把这段散文算成一个调用点（假红）。抹掉之后剩下的是代码骨架，
 * 于是正则可以只锚「调用形态」而不是锚名字。
 */
function withoutComments(text: string): string {
  const chars = text.split('')
  let inString: string | null = null
  let inLineComment = false
  let inBlockComment = false

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]
    const next = chars[i + 1]

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false
      }
      else {
        chars[i] = ' '
      }
      continue
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        chars[i] = ' '
        chars[i + 1] = ' '
        i += 1
        inBlockComment = false
      }
      else if (ch !== '\n') {
        chars[i] = ' '
      }
      continue
    }

    if (inString !== null) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === inString) {
        inString = null
      }
      continue
    }

    if (ch === '/' && next === '/') {
      chars[i] = ' '
      inLineComment = true
      continue
    }
    if (ch === '/' && next === '*') {
      chars[i] = ' '
      inBlockComment = true
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      inString = ch
    }
  }

  return chars.join('')
}

function rel(file: string) {
  return relative(SERVER_ROOT, file).split(sep).join('/')
}

function isExcluded(file: string) {
  const path = rel(file)
  return TEST_DIR_PREFIXES.some(prefix => path.startsWith(prefix))
    || TEST_SUFFIXES.some(suffix => path.endsWith(suffix))
    || EXCLUDED_PREFIXES.some(prefix => path.startsWith(prefix))
}

const productionFiles = SCAN_DIRS
  .flatMap(dir => walkTsFiles(resolve(SERVER_ROOT, dir)))
  .filter(file => !isExcluded(file))

function rawOf(file: string) {
  return readFileSync(file, 'utf8')
}

function codeOf(file: string) {
  return withoutComments(rawOf(file))
}

/**
 * `generateDeviceId(...)` 的**调用**形态。`(?<!function\s)` 把定义本体
 * （`export function generateDeviceId(`）排除掉 —— 定义不是签发点。
 */
const ISSUE_CALL_RE = /(?<!function\s)generateDeviceId\s*\(/g

describe('设备身份签发：调用点唯一、指纹派生不复存在（B5 / 14-D）', () => {
  it('生产源码里 generateDeviceId( 的调用点恰好 1 处，且在 device.service.ts 的 initial', () => {
    const issueSites = productionFiles
      .map(file => ({ file: rel(file), hits: (codeOf(file).match(ISSUE_CALL_RE) ?? []).length }))
      .filter(site => site.hits > 0)

    expect(issueSites).toEqual([{ file: 'libs/system/src/device/device.service.ts', hits: 1 }])
  })

  it('指纹派生函数（14-D 已删）在 apps/api 与 libs 里零命中，注释也算命中', () => {
    const leftovers = productionFiles
      .filter(file => /getDeviceIdByFingerprint|hashDeviceFingerprint/.test(rawOf(file)))
      .map(rel)

    expect(leftovers).toEqual([])
  })

  it('环境变量 DEVICE_ID_ENCRYPTION_KEY 已于 2026-11-04 退役：生产源码里零代码读者', () => {
    const readers = productionFiles
      .filter(file => codeOf(file).includes('DEVICE_ID_ENCRYPTION_KEY'))
      .map(rel)
      .sort()

    expect(readers).toEqual([])
  })
})
