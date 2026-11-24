/**
 * `check-nginx-headers.ts` 的用例。
 *
 * 分三块，各自防一种「门禁自己烂掉」的方式：
 *
 * 1. **解析语义** —— 用内存文本覆盖 nginx 那条继承规则的两面（server 块不互相继承、
 *    location 自己写 `add_header` 就吃掉上级的全部）。
 * 2. **真实配置** —— 直接读仓里那两份 conf。它们才是被这道门禁保护的资产；
 *    万一将来有人把 4 条删成 1 条，这里必须先红。
 * 3. **与 `deploy/post-verify.sh` 的判据一致** —— 门禁要求写的头，与部署后脚本实际核实的头，
 *    必须是同一组。**两边漂了就变成「一边在验 A、一边在验 B」**，比没有门禁更糟：
 *    它看起来覆盖了，实际谁也没覆盖全。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../../lib/repo-root.ts'
import { checkConfigText, collectFindings, NGINX_CONF_DIR, parseBlocks, REQUIRED_HEADERS } from '../check-nginx-headers.ts'

const ALL = REQUIRED_HEADERS.map(h => `    add_header ${h} "v" always;`).join('\n')

function SERVER_443(body: string) {
  return `server {
    listen 443 ssl;
    server_name a.example.com;
${body}
}
`
}

describe('parseBlocks', () => {
  it('把 server / location 收成树，并记下 listen 443 与自己的 add_header', () => {
    const root = parseBlocks(SERVER_443(`${ALL}
    location /api/ {
        add_header X-Frame-Options "SAMEORIGIN" always;
    }`), 'x.conf')

    expect(root.children).toHaveLength(1)
    const server = root.children[0]!
    expect(server.kind).toBe('server')
    expect(server.listens443).toBe(true)
    expect(server.ownHeaders).toHaveLength(REQUIRED_HEADERS.length)
    expect(server.children).toHaveLength(1)
    expect(server.children[0]!.head).toBe('location /api/')
    expect(server.children[0]!.ownHeaders).toEqual(['x-frame-options'])
  })

  it('注释里的 add_header 不算数（本仓 conf 的说明文字里全是这个词）', () => {
    const root = parseBlocks(SERVER_443('    # 这里解释 add_header 的继承规则：add_header 会被吃掉'), 'x.conf')
    expect(root.children[0]!.ownHeaders).toEqual([])
  })

  it.each([
    'listen 443;',
    'listen 443 ssl;',
    'listen 443 ssl http2;',
    'listen [::]:443 ssl;',
    'listen 0.0.0.0:443 ssl;',
  ])('认得 443 入口：%s', (directive) => {
    const root = parseBlocks(`server {\n    ${directive}\n}\n`, 'x.conf')
    expect(root.children[0]!.listens443).toBe(true)
  })

  it.each(['listen 80;', 'listen 8080;', 'listen [::]:80;', 'ssl_protocols TLSv1.3;', 'listen_port 443;'])(
    '不误认：%s',
    (directive) => {
      const root = parseBlocks(`server {\n    ${directive}\n}\n`, 'x.conf')
      expect(root.children[0]!.listens443).toBe(false)
    },
  )
})

describe('checkConfigText', () => {
  it('443 server 写全 4 条 → 无发现', () => {
    expect(checkConfigText(SERVER_443(ALL), 'x.conf')).toEqual([])
  })

  it('443 server 一条都没有 → 4 条全报（api.conf 曾经的真实状态）', () => {
    const findings = checkConfigText(SERVER_443('    ssl_protocols TLSv1.2;'), 'x.conf')
    expect(findings).toHaveLength(1)
    for (const name of REQUIRED_HEADERS)
      expect(findings[0]!.detail).toContain(name)
    expect(findings[0]!.line).toBe(1)
  })

  it('listen 80 的 server 不要求这 4 条', () => {
    const conf = 'server {\n    listen 80;\n    server_name a.example.com;\n    return 301 https://$host$request_uri;\n}\n'
    expect(checkConfigText(conf, 'x.conf')).toEqual([])
  })

  it('location 自己写了 add_header 却漏掉安全头 → 报（这是最容易犯的那一种）', () => {
    const conf = SERVER_443(`${ALL}
    location /api/ {
        add_header Access-Control-Allow-Credentials "true" always;
    }`)
    const findings = checkConfigText(conf, 'x.conf')
    expect(findings).toHaveLength(1)
    expect(findings[0]!.line).toBe(8)
    expect(findings[0]!.detail).toContain('全部不再继承')
  })

  it('location 自己写了 add_header 且写全了 4 条 → 无发现（那是必要的重复）', () => {
    const conf = SERVER_443(`${ALL}
    location /api/ {
        add_header Access-Control-Allow-Credentials "true" always;
${ALL}
    }`)
    expect(checkConfigText(conf, 'x.conf')).toEqual([])
  })

  it('location 没有自己的 add_header → 继承 server 的，无发现', () => {
    const conf = SERVER_443(`${ALL}
    location /socket/ {
        proxy_pass http://backend:5173/;
    }`)
    expect(checkConfigText(conf, 'x.conf')).toEqual([])
  })

  it('只比头名不比取值：HSTS 换个 max-age 不算问题', () => {
    const conf = SERVER_443(REQUIRED_HEADERS.map(h => `    add_header ${h} "whatever";`).join('\n'))
    expect(checkConfigText(conf, 'x.conf')).toEqual([])
  })

  it('头名大小写不敏感', () => {
    const conf = SERVER_443(REQUIRED_HEADERS.map(h => `    add_header ${h.toLowerCase()} "v" always;`).join('\n'))
    expect(checkConfigText(conf, 'x.conf')).toEqual([])
  })

  it('含 include 的块只提示、不报（宁可漏报不可误报）', () => {
    const conf = SERVER_443('    include snippets/nope.conf;')
    // 它不是"缺失"（rule 不同），`main()` 把它当 warning 打出来 —— 于是这里能**直接断言返回值**，
    // 不必再 spy 某个 `console.*`（那正是这一次把纯函数里的副作用拿掉的原因）。
    const found = checkConfigText(conf, 'x.conf')
    expect(found.map(f => f.rule)).toEqual(['include-unverified'])
    expect(found[0]!.detail).toContain('未核实')
  })
})

describe('仓库里的真实 nginx 配置', () => {
  it(`${NGINX_CONF_DIR}/ 下每一份都通过`, () => {
    expect(collectFindings()).toEqual([])
  })

  it('frontend.conf 与 api.conf 都各自带全了这 4 条（并列 server 块不互相继承）', () => {
    for (const name of ['frontend.conf', 'api.conf']) {
      const text = readFileSync(join(REPO_ROOT, NGINX_CONF_DIR, name), 'utf8')
      for (const header of REQUIRED_HEADERS)
        expect(text, `${name} 缺 ${header}`).toContain(header)
    }
  })
})

describe('与 deploy/post-verify.sh 的判据一致', () => {
  const postVerify = readFileSync(join(REPO_ROOT, 'deploy/post-verify.sh'), 'utf8')

  it.each(REQUIRED_HEADERS)('post-verify.sh 也在核实 %s', (header) => {
    expect(postVerify).toContain(header)
  })

  it('post-verify.sh 里没有本门禁不知道的第 5 个头（两边必须同一组）', () => {
    // 只在 check_security_headers 的 for 循环那一行上取名单 —— 别把整个脚本里的
    // `Content-Type` 之类误当成安全头。
    const loop = /for name in ([^;]+); do/.exec(postVerify)
    expect(loop, 'post-verify.sh 里找不到 `for name in …` 的头名清单').not.toBeNull()
    const names = loop![1]!.trim().split(/\s+/)
    expect([...names].sort()).toEqual([...REQUIRED_HEADERS].sort())
  })
})
