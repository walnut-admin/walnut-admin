/**
 * `deploy/nginx/conf.d/*.conf` 的安全响应头体检。
 *
 * 防的失败：nginx 的 `add_header` 是**整段替换**而不是合并 —— 下级块只要自己写了一条
 * `add_header`，上级块的全部 `add_header` 都不再继承。所以最常见的坏改动是给某个 `location`
 * 加一条 `add_header Cache-Control …`，那个 location 就**静默地**丢掉 server 级安全头：
 * 配置还在、`nginx -t` 是绿的、浏览器那边却没有 HSTS。`conf.d/` 下各 `server` 块同样**并列**，
 * 互相也拿不到任何头。
 *
 * 与 `deploy/post-verify.sh` 的分工：那是**部署后**核实（镜像已 pull、容器已 recreate），
 * 这一段把同一判据提前到推送前（纯读盘），让「少写一条 `add_header`」在本地就红。
 * 头的名字只有一处真源（{@link REQUIRED_HEADERS}），两段的一致性由 `nginx-headers.test.ts`
 * 机械核对 —— 漂了就成了「看着有门禁」。
 *
 * 判据刻意宽松（宁可漏报不可误报）：只比头名不比取值（`max-age` 之类会随运维调）；不跟随
 * `include`（遇到就打印提示并跳过该块）；只管 `conf.d/*.conf`（`deploy/nginx/frontend-server.conf`
 * 是镜像内部那个 `server_name _`，浏览器看不到）；`listen 80` 的跳转块不要求（HSTS 在明文 HTTP
 * 上本就被浏览器忽略）。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 安全响应头的**唯一真源**（`deploy/post-verify.sh` 必须验同一组，由测试机械核对） */
export const REQUIRED_HEADERS: readonly string[] = [
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
]

/** 本门禁扫描的目录（相对仓库根） */
export const NGINX_CONF_DIR = 'deploy/nginx/conf.d'

export interface Finding {
  rule: string
  /** 文件相对仓库根的路径 */
  file: string
  /** 1-based 行号（指向出问题的那个块的开头） */
  line: number
  detail: string
}

export interface NginxBlock {
  /** `server` / `location` / 文件名（顶层） */
  kind: string
  /** 块的匹配串，如 `location /api/`；顶层为文件名 */
  head: string
  /** 1-based 行号 */
  line: number
  /** 本块自己声明的头名（已小写；空数组 = 本块没有 `add_header`） */
  ownHeaders: string[]
  /** 本块 `listen` 里是否出现 443 */
  listens443: boolean
  /** 本块是否含 `include`（含则跳过，见文件头「宁可漏报」） */
  hasInclude: boolean
  /** 直接子块 */
  children: NginxBlock[]
}

/** 去掉行内注释（nginx 的 `#` 到行尾；本仓 conf 里没有字符串内含 `#` 的情形） */
function stripComment(line: string): string {
  const i = line.indexOf('#')
  return i >= 0 ? line.slice(0, i) : line
}

const HEADER_DIRECTIVE = /^\s*add_header\s+([A-Z0-9-]+)/i
const BLOCK_OPEN = /^\s*(server|location|if|limit_except)\b([^{]*)\{/

/**
 * 这一行是否让**当前块**成为 443 入口。
 *
 * 刻意拆出来手写而不是一条正则：`listen 443 ssl;` / `listen 443 ssl http2;` /
 * `listen [::]:443 ssl;` 都要认，而「一条能全认的正则」既难读又必然写出相邻的重叠量词
 * （`^\s*listen\s+`），当场触发本仓开着的 `regexp/no-super-linear-backtracking`。
 */
function listensOn443(line: string): boolean {
  const tokens = line.trim().split(/[\s;]+/)
  if (tokens[0] !== 'listen')
    return false
  const addr = tokens[1] ?? ''
  return addr === '443' || addr.endsWith(':443')
}

/**
 * 把一份 nginx 配置解析成块树。
 *
 * 刻意手写、刻意只看这几条指令（`server` / `location` / `add_header` / `listen` / `include`）：
 * 目标是**判断这 4 个头有没有被漏写**，不是实现一个 nginx 解析器。
 * 认不出的行一律忽略 —— 漏报是安全的，误报不是。
 */
export function parseBlocks(text: string, fileName: string): NginxBlock {
  const root: NginxBlock = {
    kind: 'file',
    head: fileName,
    line: 1,
    ownHeaders: [],
    listens443: false,
    hasInclude: false,
    children: [],
  }
  const stack: NginxBlock[] = [root]

  text.split('\n').forEach((rawLine, index) => {
    const line = stripComment(rawLine)
    if (line.trim() === '')
      return
    const top = stack[stack.length - 1]!

    if (/^\s*include\b/.test(line))
      top.hasInclude = true

    if (listensOn443(line))
      top.listens443 = true

    const header = HEADER_DIRECTIVE.exec(line)
    if (header)
      top.ownHeaders.push(header[1]!.toLowerCase())

    const open = BLOCK_OPEN.exec(line)
    if (open) {
      const block: NginxBlock = {
        kind: open[1]!,
        head: line.trim().replace(/\s*\{$/, ''),
        line: index + 1,
        ownHeaders: [],
        listens443: false,
        hasInclude: false,
        children: [],
      }
      top.children.push(block)
      stack.push(block)
      return
    }

    // 一个块在**同一行**里既开又合（`location /x { proxy_pass …; }`）本仓没有，
    // 但 `}` 的进出必须按行数平衡，否则嵌套关系会错位。
    const closes = (line.match(/\}/g) ?? []).length
    for (let i = 0; i < closes && stack.length > 1; i++)
      stack.pop()
  })

  return root
}

/** 某块**生效**的头名集合：自己有 `add_header` 就只算自己的，否则整份继承父块（nginx 规则） */
export function effectiveHeaders(block: NginxBlock, parent: readonly string[]): string[] {
  return block.ownHeaders.length > 0 ? block.ownHeaders : [...parent]
}

/** 一个块缺哪些必需头（宽松判据，见文件头） */
function missingIn(block: NginxBlock, parentHeaders: readonly string[]): string[] {
  const effective = new Set(effectiveHeaders(block, parentHeaders))
  return REQUIRED_HEADERS.filter(name => !effective.has(name.toLowerCase()))
}

/**
 * 体检一份配置。
 *
 * 规则只有两条（正好覆盖 nginx 那条继承规则的两面）：
 * 1. 每个 `listen 443` 的 `server` 块**自己**必须写全这 4 个头；
 * 2. 任何**自己写了 `add_header`** 的 `location` 块必须自己写全这 4 个 ——
 *    它继承了父块的就没关系（`missingIn` 会把继承算进去）。
 */
export function checkConfigText(text: string, file: string): Finding[] {
  const findings: Finding[] = []
  const root = parseBlocks(text, file)

  const walk = (block: NginxBlock, inherited: readonly string[]): void => {
    for (const child of block.children) {
      const parentEffective = effectiveHeaders(block, inherited)

      if (child.hasInclude) {
        // ⚠️ 纯函数不打印：这里只产 finding，由 `main()` 把 `include-unverified` 当**提示**打出来。
        // 不要改回 `console.warn` —— 那样用例只能靠 spy 断言。
        findings.push({
          rule: 'include-unverified',
          file,
          line: child.line,
          detail: `${child.head} 里有 \`include\`，本门禁不跟随它 ⇒ 该块**未核实**`,
        })
        walk(child, parentEffective)
        continue
      }

      const isPublicServer = child.kind === 'server' && child.listens443
      const overridesParent = child.ownHeaders.length > 0

      if (isPublicServer || overridesParent) {
        const missing = missingIn(child, parentEffective)
        if (missing.length > 0) {
          const reason = isPublicServer
            ? '这是 443 的 `server` 块（公网入口），且各 `server` 块之间不互相继承'
            : '本块自己写了 `add_header`，于是上级的 `add_header` **全部不再继承**（nginx 规则：整段替换，不是合并）'
          findings.push({
            rule: 'nginx-security-headers',
            file,
            line: child.line,
            detail: `${child.head} 缺 [${missing.join(', ')}] —— ${reason}`,
          })
        }
      }

      walk(child, parentEffective)
    }
  }

  walk(root, [])
  return findings
}

/** 扫描整个 `conf.d`（相对路径 → 内容由调用方给，便于用例喂内存文本） */
export function collectFindings(dir = join(REPO_ROOT, NGINX_CONF_DIR)): Finding[] {
  const findings: Finding[] = []
  const files = readdirSync(dir).filter(f => f.endsWith('.conf')).sort()
  if (files.length === 0) {
    return [{
      rule: 'precondition',
      file: NGINX_CONF_DIR,
      line: 1,
      detail: `${NGINX_CONF_DIR}/ 下一个 .conf 都没有 —— 部署入口配置不该是空的（目录被搬走 / 改名了？）`,
    }]
  }
  for (const name of files)
    findings.push(...checkConfigText(readFileSync(join(dir, name), 'utf8'), `${NGINX_CONF_DIR}/${name}`))
  return findings
}

export function main(): void {
  const all = collectFindings()
  const precondition = all.filter(f => f.rule === 'precondition')

  if (precondition.length > 0)
    throw new PreconditionError(precondition.map(f => f.detail).join('\n'))

  // `include-unverified` 是**提示**不是违规（见 `checkConfigText` 里的说明）—— 单独走 warning 通道
  const unverified = all.filter(f => f.rule === 'include-unverified')
  const findings = all.filter(f => f.rule !== 'include-unverified')

  for (const f of unverified)
    lineErr('warning', `${f.file}:${f.line} ${f.detail}`)

  if (findings.length === 0) {
    line('ok', `入口 nginx 安全响应头（${NGINX_CONF_DIR}）：${REQUIRED_HEADERS.length} 个头在各 server/location 块上都到位${unverified.length > 0 ? '（有 include 的块未核实，见上方提示）' : ''}`)
    out('  提示：这一段只证明**配置写对了**；"头真的发出去了"由 deploy/post-verify.sh 在每次部署后核实。')
    return
  }

  lineErr('violation', `入口 nginx 有 ${findings.length} 处安全响应头缺失：\n`)
  for (const f of findings)
    err(`  ${f.file}:${f.line}  ${f.detail}`)
  err(`
修法：把那 ${REQUIRED_HEADERS.length} 条 \`add_header\` 补到出问题的块里（取值照抄同级已有的那几条）。`)
  err('为什么不能只写一份：https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header')
  throw new ViolationError(`入口 nginx 有 ${findings.length} 处安全响应头缺失（明细见上）`)
}
