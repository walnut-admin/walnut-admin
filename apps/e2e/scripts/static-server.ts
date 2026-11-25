/**
 * E2E 的测试静态代理（监听 4173）：
 * - 伺服 `apps/admin/dist-staging`（SPA：未知路径回落到 index.html）；
 * - `/api/**` 反代到后端 `http://127.0.0.1:3001/w/v1/**`，**保留**浏览器请求头
 *   （尤其 `X-Forwarded-For`：`@supercharge/request-ip` 是 header 优先，IP 矩阵用例靠它
 *   指定 realIp；UA / Cookie / Authorization / X-Sign 等也必须原样过去）；
 * - `/socket/**` 反代到后端 socket.io 端口（HTTP 轮询与 WebSocket upgrade 两条腿都接），
 *   路径改写成 `.env.stage` 的 `SOCKET_SERVER_PATH`（`/walnut-path/`）。
 *
 * 为什么自己写而不是用 Vite preview / nginx：dist-staging 里的 `VITE_PROXY` 把 API 根写成
 * 相对 `/api`，需要一个同源代理把它接到**独立栈**的后端；而 E2E 要能指定 XFF、要让 SSE/WS
 * 都能过 —— 这些在测试侧都要可控，且不引入额外依赖。
 *
 * 刻意不做的事：不改写 `X-Forwarded-For`（客户端给什么就传什么；没给就让后端看到
 * 127.0.0.1 = 本地 IP，走 getLocalLocation 零外网）。
 */
import type { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import {
  ADMIN_DIST_DIR,
  ADMIN_INDEX_FILE,
  API_PREFIX,
  API_VERSION,
  BACKEND_PORT,
  parseEnvFile,
  SERVER_STAGE_ENV_FILE,
  SOCKET_PORT,
  WEB_PORT,
} from './env.ts'
import { E2ePreconditionError, EXIT_FAILURE, EXIT_PRECONDITION, reportFailure } from './failure.ts'

const API_UPSTREAM_PREFIX = `/${API_PREFIX}/v${API_VERSION}`
const SOCKET_PATH = (() => {
  try {
    const env = parseEnvFile(readFileSync(SERVER_STAGE_ENV_FILE, 'utf8'))
    return env.SOCKET_SERVER_PATH ?? '/walnut-path/'
  }
  catch {
    return '/walnut-path/'
  }
})()

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

function contentTypeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** `/api/foo?x=1` → `/w/v1/foo?x=1`；`/socket/...` → `/walnut-path/...` 的同一条拼接 */
function upstreamPathFor(url: string): { port: number, path: string } | null {
  const queryIndex = url.indexOf('?')
  const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex)
  const search = queryIndex === -1 ? '' : url.slice(queryIndex)

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const rest = pathname.slice('/api'.length)
    return { port: BACKEND_PORT, path: `${API_UPSTREAM_PREFIX}${rest === '' ? '/' : rest}${search}` }
  }

  if (pathname === '/socket' || pathname.startsWith('/socket/')) {
    const rest = pathname.slice('/socket'.length)
    const base = SOCKET_PATH.endsWith('/') ? SOCKET_PATH.slice(0, -1) : SOCKET_PATH
    return { port: SOCKET_PORT, path: `${base}${rest === '' ? '/' : rest}${search}` }
  }

  return null
}

function proxyHttp(req: IncomingMessage, res: ServerResponse): void {
  const target = upstreamPathFor(req.url ?? '/')
  if (target === null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }

  // 只改 Host（上游要看到自己的地址）；其余头原样透传 —— 包括 X-Forwarded-For。
  const headers: Record<string, string | string[]> = { ...req.headers } as Record<string, string | string[]>
  headers.host = `127.0.0.1:${target.port}`

  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port: target.port,
      method: req.method,
      path: target.path,
      headers,
    },
    (upstreamRes) => {
      // rawHeaders 数组保留重复头（反代多枚 Set-Cookie 的唯一正确姿势）
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.rawHeaders)
      // 上游在中途断（后端被杀 / 连接重置）：客户端不能收到「看起来完整」的半截响应
      upstreamRes.on('error', () => res.destroy())
      // 客户端提前断开（浏览器取消 / 用例超时）：别让上游继续写进死 socket
      res.once('close', () => upstreamRes.destroy())
      upstreamRes.pipe(res)
    },
  )

  upstream.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    }
    res.end(`[e2e/static-server] upstream error: ${error.message}`)
  })

  // 请求体读取失败（客户端中途断）：上游请求跟着收掉，避免悬挂
  req.on('error', () => upstream.destroy())

  req.pipe(upstream)
}

/** WebSocket upgrade：把 /socket 的 upgrade 改写到 socket.io 的 path 后双向裸管道 */
function proxyUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const target = upstreamPathFor(req.url ?? '/')
  if (target === null) {
    socket.destroy()
    return
  }

  const upstream = connect(target.port, '127.0.0.1', () => {
    const rawHeaders = req.rawHeaders.slice()
    // 替换 Host（成对出现：name, value）
    const hostIndex = rawHeaders.findIndex((value, index) => index % 2 === 0 && value.toLowerCase() === 'host')
    if (hostIndex !== -1) {
      rawHeaders[hostIndex + 1] = `127.0.0.1:${target.port}`
    }

    const lines = [`${req.method ?? 'GET'} ${target.path} HTTP/1.1`]
    for (let i = 0; i < rawHeaders.length; i += 2) {
      lines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}`)
    }
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head.length > 0) {
      upstream.write(head)
    }
    upstream.pipe(socket)
    socket.pipe(upstream)
  })

  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
}

/** 存在的普通文件？statSync 与 existsSync 之间有 TOCTOU 窗口（EACCES / ENOENT 也走这里） */
function isRegularFile(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).isFile()
  }
  catch {
    return false
  }
}

/**
 * 把一个文件流式回给客户端。
 *
 * 为什么不能 `createReadStream(file).pipe(res)` 了事：没有 `error` handler 时，读失败会变成
 * 未捕获异常、把 static-server 整个进程带走（E2E 的 webServer 一死，后面所有用例都变成连接失败）。
 * 头未发 ⇒ 500；已发 ⇒ 中断连接（别把半截响应当完整响应）。
 */
function sendFile(res: ServerResponse, file: string, headers: Record<string, string>): void {
  const stream = createReadStream(file)

  stream.once('error', () => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('internal error')
  })

  // 客户端提前断开（curl --limit-rate 中途 kill）：别让文件句柄与流继续跑
  res.once('close', () => stream.destroy())

  // 头等到 open 再写：open 失败才能在 headersSent=false 时给 500
  stream.once('open', () => {
    if (res.destroyed) {
      stream.destroy()
      return
    }
    res.writeHead(200, headers)
    stream.pipe(res)
  })
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? '/'
  let pathname: string
  try {
    pathname = decodeURIComponent(url.split('?')[0] ?? '/')
  }
  catch {
    // 非法百分号编码（如 /%E0%A4%A）：400 而不是让 URIError 变成未捕获异常
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('bad request')
    return
  }

  const resolved = path.resolve(ADMIN_DIST_DIR, `.${pathname}`)
  // 目录穿越防线：解析结果必须仍在 dist 目录内
  const inside = resolved === ADMIN_DIST_DIR || resolved.startsWith(`${ADMIN_DIST_DIR}${path.sep}`)

  if (!inside) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('forbidden')
    return
  }

  if (isRegularFile(resolved)) {
    const isHtml = pathname === '/' || pathname.endsWith('.html')
    sendFile(res, resolved, {
      'content-type': contentTypeOf(resolved),
      // index.html 不快缓存：否则改了产物/加了新 hash 的 chunk 仍拿旧入口（E2E 反复重建产物）
      'cache-control': isHtml ? 'no-store' : 'public, max-age=3600',
    })
    return
  }

  // SPA 回落：无扩展名的路径（/auth、/home、/not-allowed…）一律给 index.html
  if (path.extname(pathname) === '') {
    const indexFile = path.join(ADMIN_DIST_DIR, 'index.html')
    if (isRegularFile(indexFile)) {
      sendFile(res, indexFile, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return
    }
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}

function main(): void {
  if (!existsSync(ADMIN_INDEX_FILE)) {
    throw new E2ePreconditionError(
      `找不到 ${ADMIN_INDEX_FILE} —— 先跑 \`pnpm --filter @walnut/admin build:stage\`（或根上 \`pnpm walnut build:stage\`）`,
    )
  }

  const server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    if (pathname === '/__e2e/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/socket' || pathname.startsWith('/socket/')) {
      proxyHttp(req, res)
      return
    }
    serveStatic(req, res)
  })

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '/').split('?')[0]
    if (pathname === '/socket' || pathname.startsWith('/socket/')) {
      proxyUpgrade(req, socket, head)
      return
    }
    socket.destroy()
  })

  // 监听失败基本都是环境问题（端口被占 / 无权限）：按「环境没准备好」（2）收场，
  // 与「反代逻辑坏了」（1）区分开。
  server.on('error', (error: NodeJS.ErrnoException) => {
    const precondition = error.code === 'EADDRINUSE' || error.code === 'EACCES'
    const hint = error.code === 'EADDRINUSE'
      ? ' —— 4173 被残留进程占着？见 apps/e2e/README.md 的「排障」'
      : ''
    console.error(`[e2e/static-server] 监听 ${WEB_PORT} 失败（${error.code ?? error.message}）${hint}`)
    process.exitCode = precondition ? EXIT_PRECONDITION : EXIT_FAILURE
  })

  server.listen(WEB_PORT, '127.0.0.1', () => {
    console.log(`[e2e/static-server] ${ADMIN_DIST_DIR} @ http://127.0.0.1:${WEB_PORT} → api :${BACKEND_PORT}${API_UPSTREAM_PREFIX}, socket :${SOCKET_PORT}${SOCKET_PATH}`)
  })
}

try {
  main()
}
catch (error) {
  process.exitCode = reportFailure('e2e/static-server', error)
}
