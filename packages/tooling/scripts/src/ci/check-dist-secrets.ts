/**
 * `apps/admin/dist` 的**去密体检**：交付给浏览器的产物里不许有机密。
 *
 * ## 它防的是哪一种失败
 *
 * 前端产物是**公开文件** —— 任何人打开 DevTools 就能读到全部字节。而"把后端 env 泄进前端"
 * 在本仓有一条**现成的、静默的**路径：`apps/server/env-local/` 与 `apps/admin/env-local/`
 * 是两套 env（都由 `pnpm setup-env` 解密），只要有一行从前者被搬到后者、或被某个 import
 * 间接读到，值就会被打包进去，而**构建、类型检查、lint、测试全都不会响**。
 * 产物侧此前**零门禁**（`@walnut/admin` 的 build 只有 `vite build`）。
 *
 * ## ⚠️ 为什么这里只有 5 条规则 —— 每条都是在**真产物**上试出来的
 *
 * 2026-09-23 在 12.68 MB / 1471 个文件的真实 `apps/admin/dist` 上逐条试过。**被否掉的规则与
 * 被采纳的同样重要**，因为一个开始误报的门禁等于没有门禁：
 *
 * | 候选规则 | 实测结果 | 结论 |
 * |---|---|---|
 * | 裸 `-----BEGIN … PRIVATE KEY-----` | **1 次命中**，是 WebCrypto 导出 PEM 时的**模板常量** | ❌ 否掉，改成"头 + ≥100 字符 base64 正体" |
 * | 「机密词键名 = 值」正则 | **8 次命中全是误报**：演示账号 `password:`2020abcd``、localStorage 键名枚举、`/auth/refresh` 路由、第三方解析器的报错文案 | ❌ 否掉（前端产物里 `xxx:` 后面跟字符串太常见） |
 * | 超长 base64（≥200） | **5 次命中全是内联 data-URI 图片**（`iVBORw0KGgo…`） | ❌ 否掉 |
 * | `AKIA…` / `AKID…` / `SecretId…` | 0 次 | ✅ 采纳 |
 * | 带凭据的 `mongodb://u:p@` / `redis://u:p@` | 0 次 | ✅ 采纳 |
 * | JWT 三段 | 0 次 | ✅ 采纳 |
 * | 产物里出现**后端** env 的机密值 | 0 次（见下） | ✅ 采纳，这是最硬的一条 |
 *
 * ## 机密源为什么只取 `apps/server/env-local/`，不取 `apps/admin/env-local/`
 *
 * `apps/admin/env-local/` 里全是 `VITE_*` —— 它们**本来就该进产物**（Vite 在构建时把这些
 * 键替换成字面量，所以产物里连 `VITE_` 这个词都搜不到，实测 0 个）。拿它当机密源等于
 * 100% 误报。前端 env 与后端 env 的这层区别就是本规则的全部前提。
 *
 * 键名判定同样收得很紧（只认 `SECRET` / `PASSWORD` / `_PASS` / `PRIVATE_KEY` /
 * `ENCRYPTION_KEY` / `HASH_SALT` / `ACCESS_KEY` / `…TOKEN…` / `CLIENTSECRET` 这类词）。
 * 更松的写法（含裸 `KEY` 或 `ACCESS`）实测会命中 `VENDOR_KEYS_ALI_OSS_BUCKET` /
 * `…_REGION` —— 那两个值是**给浏览器用的**（前端直传 OSS），6 条误报全出自它们。
 * **别把这条放宽回去**；要放宽带的是新键名的命名，不是这里的模式。
 *
 * ⚠️ **AK ID 的形状**由 `AKIA…` / `AKID…` 两条形状规则覆盖，不靠键名里的 `_ID`
 * ——`_ID` 会顺带命中 `VENDOR_KEYS_TX_SMS_SDK_APP_ID` 这类**公开**的 AppID。
 *
 * ## 前置条件与降级（刻意不静默）
 *
 * - `dist` 不存在 → **退出码 2**（前置条件未满足），不是"通过"。没产物就没得体检，
 *   这正是最容易被写成"恒绿"的地方。CI 里它紧跟 `Build admin`，所以这条等价于"构建没产出"。
 * - `apps/server/env-local/` 不存在（没解密，比如 fork PR）→ 打印一行"跳过 env 真值比对"，
 *   **形状规则照跑**，退出码不受影响。少一条规则是**漏报**，不是误报。
 * - 预压缩的 `.br` / `.gz` 不单独扫：它们是同名 `.js` 的压缩副本，扫源文件即覆盖；
 *   而且压缩流根本 grep 不动（要真有只在压缩文件里的东西，那本身就该先问为什么）。
 *
 * ## 判据刻意宽松的地方
 *
 * 只找**形态**与**已知真值**，不做熵值分析。「高熵字符串」在前端产物里遍地都是
 * （sourcemap、哈希文件名、压缩后的变量名），那种规则 100% 误报。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 默认体检对象（相对仓库根） */
export const DEFAULT_DIST_DIR = 'apps/admin/dist'
/** 机密值的来源（相对仓库根）—— **只有后端这一份**，见文件头 */
export const DEFAULT_SECRET_ENV_DIR = 'apps/server/env-local'

/** 会被当文本读的产物后缀（其余按二进制跳过） */
export const TEXT_FILE = /\.(?:js|mjs|cjs|jsx|css|html|htm|json|json5|map|txt|xml|svg)$/i

/** 键名里出现这些词就认为"它的值是机密"（见文件头：别放宽） */
export const SECRETISH_KEY = /SECRET|PASSWORD|PASSWD|(?:^|_)PASS(?:_|$)|PRIVATE_KEY|ENCRYPTION_KEY|HASH_SALT|ACCESS_KEY|(?:^|_)AK(?:_|$)|(?:^|_)SK(?:_|$)|TOKEN|CREDENTIAL/i

/** 产物里出现这些**文件名**本身就是事故（比内容扫描更硬的判据） */
export const BAD_FILE_NAME = /(?:^|[\\/])(?:\.env(?:\..+)?|\.npmrc|id_rsa[^\\/]*)$|\.(?:pem|key|p12|pfx|jks|keystore)$/i

const PEM_PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{0,40}?[A-Za-z0-9+/=\s]{100,}/
// 用户名可以为空（`redis://:pw@host` 是 Redis 的常见写法），口令必须非空，且**得像真口令**：
// 见下面的 `looksLikeRealPassword`。
const URI_WITH_CREDENTIALS = /(?:mongodb(?:\+srv)?|rediss?):\/\/([^\s"'`/@:]*):([^\s"'`/@]+)@/g
const JWT = /eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/
/** AWS `AKIA…` + 腾讯云 `AKID…`。**只认 AK ID 的形状**，见文件头（不靠键名里的 `_ID`） */
const CLOUD_ACCESS_KEY = /AKIA[0-9A-Z]{16}|AKID[0-9A-Za-z]{13,}/

/**
 * 这段"口令"像不像真口令。
 *
 * 收窄是**量出来的**：2026-09-23 拿同一份规则表扫全仓 2064 个文本文件，5 处命中里有 **4 处**
 * 是「格式说明 / 本地开发容器的默认口令」——`mongodb://u:p@`（文档里在描述规则）、
 * `mongodb://root:123456@127.0.0.1`（bitnami 镜像的本地默认值）、我自己注释里的 `redis://:pw@host`。
 * 它们的共同点是**口令短或纯数字**，而真实部署的口令不会是那样。
 *
 * 于是判据收成：**长度 ≥ 8 且至少含一个非数字字符**。代价是"6 位数字口令的真凭据"会漏报 ——
 * 那正是 `宁可漏报不可误报` 的取舍方向（一个开始误报的门禁等于没有门禁）。
 */
export function looksLikeRealPassword(password: string): boolean {
  return password.length >= 8 && /\D/.test(password)
}

/** 找第一处「带凭据且口令像真的」连接串（返回下标，供报行号用） */
export function findCredentialUri(text: string): { index: number } | null {
  for (const matched of text.matchAll(URI_WITH_CREDENTIALS)) {
    if (looksLikeRealPassword(matched[2]!))
      return { index: matched.index ?? 0 }
  }
  return null
}

export interface Finding {
  rule: string
  /** 相对仓库根的路径 */
  file: string
  detail: string
  /** 命中位置在文件里的字符下标（源码侧据此报行号；产物侧用不上） */
  index?: number
}

export interface SecretValue {
  /** env 键名（可以进日志） */
  key: string
  /** 值（**绝不进日志**） */
  value: string
  /** 机密值来自哪个文件 */
  source: string
}

/** 去掉预压缩后缀：`a.js.br` → `a.js`（否则按文件名的那条规则会漏） */
export function stripPrecompressed(name: string): string {
  return name.replace(/\.(?:br|gz|zst)$/i, '')
}

/**
 * 一个文本文件里的形态命中（不含 env 真值比对，那条要外部喂值）。
 *
 * 产物侧与**源码侧**共用这一份规则表 —— 这是刻意的：源码侧另立一套必然漂移，
 * 而真正要防的是同一件事（"凭据形状的东西进了仓库 / 进了产物"）。
 * `index` 只在源码侧用（报行号），产物侧不需要。
 *
 * **每条规则只报第一处**：门禁只需要"红"，而同一文件里同规则的重复命中会把输出刷屏
 * （压缩后的产物尤其如此）。修完第一处再跑一次即可。
 */
export function scanText(text: string, file: string): Finding[] {
  const findings: Finding[] = []
  const pem = PEM_PRIVATE_KEY.exec(text)
  if (pem !== null)
    findings.push({ rule: 'pem-private-key', file, index: pem.index, detail: '有真正带 base64 正体的 PEM 私钥块' })
  const uri = findCredentialUri(text)
  if (uri !== null)
    findings.push({ rule: 'credential-uri', file, index: uri.index, detail: '有带用户名/口令的连接串（mongodb / redis），且口令看着像真的' })
  const jwt = JWT.exec(text)
  if (jwt !== null)
    findings.push({ rule: 'jwt', file, index: jwt.index, detail: '有 JWT 三段式字符串' })
  const ak = CLOUD_ACCESS_KEY.exec(text)
  if (ak !== null)
    findings.push({ rule: 'cloud-access-key', file, index: ak.index, detail: `有云厂商 AccessKey 形状的串（${ak[0].slice(0, 4)}…，共 ${ak[0].length} 字符）` })
  return findings
}

/** 字符下标 → 1-based 行号（源码侧报位置用） */
export function lineOf(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n')
      line++
  }
  return line
}

/**
 * 产物里有没有出现某个机密值。
 *
 * ⚠️ **只报键名与文件，永不回显值** —— 这个函数的输出会进 CI 日志，而 CI 日志是公开面。
 * 用例里有一条专门钉这件事。
 */
export function findLeakedValues(text: string, file: string, secrets: readonly SecretValue[]): Finding[] {
  const findings: Finding[] = []
  for (const secret of secrets) {
    if (text.includes(secret.value)) {
      findings.push({
        rule: 'env-value-leak',
        file,
        detail: `产物里出现了后端 env 的机密值：\`${secret.key}\`（值不回显；来自 ${secret.source}）`,
      })
    }
  }
  return findings
}

/**
 * 从 `.env*` 文本里取出「键名像机密」的那些值。
 *
 * 手写解析而不是一条 `^\s*([A-Z_]+)\s*=\s*(.+?)\s*$`：那种写法必然出现相邻的重叠量词，
 * 当场触发本仓开着的 `regexp/no-super-linear-backtracking`（`check-nginx-headers` 踩过同一个坑）。
 */
export function parseSecretValues(text: string, source: string): SecretValue[] {
  const out: SecretValue[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#'))
      continue
    const eq = line.indexOf('=')
    if (eq <= 0)
      continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || !SECRETISH_KEY.test(key))
      continue
    // 与 dotenv 一致：值后面的 ` # 注释` 不算值的一部分
    const head = line.slice(eq + 1).split(/\s+#/)[0] ?? ''
    const value = head.trim().replace(/^["']|["']$/g, '')
    // 太短 / 是布尔与端口这类值的，全仓到处都是 ⇒ 比了必误报（实测：`JWT_…_EXPIRE` 是纯数字）
    if (value.length < 8 || /^(?:true|false|localhost|\d+)$/i.test(value))
      continue
    out.push({ key, value, source })
  }
  return out
}

/** 读一个 env 目录下所有文件的机密值（目录不存在返回空数组，调用方据此降级） */
export function collectSecretValues(envDir: string): SecretValue[] {
  if (!existsSync(envDir))
    return []
  const out: SecretValue[] = []
  for (const name of readdirSync(envDir).sort())
    out.push(...parseSecretValues(readFileSync(join(envDir, name), 'utf8'), name))
  return out
}

export interface ScanStats {
  files: number
  textFiles: number
  skippedBinary: number
  bytes: number
}

export interface ScanResult {
  findings: Finding[]
  stats: ScanStats
  /** 机密值条数（用于打印"比对了 N 条"）；值为 0 = 没解密，已降级 */
  secretCount: number
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory())
      out.push(...walk(path))
    else out.push(path)
  }
  return out
}

/** 体检整棵产物树。路径均可注入，便于用例喂夹具。 */
export function scanDist(distDir: string, secretEnvDir: string): ScanResult {
  const secrets = collectSecretValues(secretEnvDir)
  const findings: Finding[] = []
  const stats: ScanStats = { files: 0, textFiles: 0, skippedBinary: 0, bytes: 0 }

  for (const path of walk(distDir)) {
    const rel = relative(REPO_ROOT, path).split('\\').join('/')
    stats.files++
    stats.bytes += statSync(path).size

    if (BAD_FILE_NAME.test(stripPrecompressed(path))) {
      findings.push({
        rule: 'bad-file-name',
        file: rel,
        detail: `产物里出现了不该发布的文件（凭据 / env 文件）：${stripPrecompressed(path).split(/[\\/]/).pop()}`,
      })
    }

    // 预压缩副本是同一个文件的压缩版：扫源文件即覆盖，且压缩流 grep 不动（见文件头）
    if (/\.(?:br|gz|zst)$/i.test(path)) {
      stats.skippedBinary++
      continue
    }
    if (!TEXT_FILE.test(path)) {
      stats.skippedBinary++
      continue
    }
    stats.textFiles++
    const text = readFileSync(path, 'utf8')
    findings.push(...scanText(text, rel))
    findings.push(...findLeakedValues(text, rel, secrets))
  }

  return { findings, stats, secretCount: secrets.length }
}

/** 仓库默认口径 */
export function collectFindings(distDir = join(REPO_ROOT, DEFAULT_DIST_DIR)): ScanResult & { precondition?: string } {
  if (!existsSync(distDir)) {
    return {
      findings: [],
      stats: { files: 0, textFiles: 0, skippedBinary: 0, bytes: 0 },
      secretCount: 0,
      precondition: `产物目录不存在：${distDir}\n  体检的前提是先构建：\`pnpm exec turbo run build --filter=@walnut/admin\`（它需要解密后的 VITE_* env）。`,
    }
  }
  return scanDist(distDir, join(REPO_ROOT, DEFAULT_SECRET_ENV_DIR))
}

export function main(argv: string[] = []): void {
  // 允许显式传产物目录（本地对着别处的产物跑），默认仓库里那份
  const distDir = argv[0] === undefined
    ? join(REPO_ROOT, DEFAULT_DIST_DIR)
    : (isAbsolute(argv[0]) ? argv[0] : join(REPO_ROOT, argv[0]))

  const result = collectFindings(distDir)
  if (result.precondition !== undefined)
    throw new PreconditionError(result.precondition)

  const mb = (result.stats.bytes / 1024 / 1024).toFixed(2)
  line('ok', `产物去密体检：${DEFAULT_DIST_DIR}（${result.stats.files} 个文件 / ${mb} MB；扫文本 ${result.stats.textFiles}，跳过压缩/二进制 ${result.stats.skippedBinary}）`)
  if (result.secretCount === 0) {
    lineErr('warning', ` ${DEFAULT_SECRET_ENV_DIR}/ 不存在（没解密？）⇒ **跳过 env 真值比对**，只跑了形状规则。形状规则拦不住「恰好不像任何形状」的机密，这是漏报面不是通过面。`)
  }
  else {
    out(`   env 真值比对：拿 ${DEFAULT_SECRET_ENV_DIR}/ 里 ${result.secretCount} 个**键名像机密**的值逐个在产物里找过`)
  }

  if (result.findings.length === 0) {
    line('ok', '产物里没有机密形态、没有后端 env 机密值、没有凭据文件。')
    return
  }

  lineErr('violation', `产物里有 ${result.findings.length} 处疑似机密泄漏 —— **产物是公开文件**，先当作已泄漏处理：\n`)
  for (const f of result.findings)
    err(`  [${f.rule}] ${f.file}\n      ${f.detail}`)
  err('\n修法：先确认它是不是真值（本页刻意不回显值，避免 CI 日志二次泄漏）。')
  err('若是真值：① 轮换那个凭据；② 找到它是怎么进去的（多半是某行 env 从 server 搬到了 admin）；')
  err('③ 修完后重跑本门禁。若判定是误报，请把**这条规则的判据**写进 check-dist-secrets.ts 顶部的表里，而不是加白名单。')
  throw new ViolationError(`产物里有 ${result.findings.length} 处疑似机密泄漏（明细见上）`)
}
