/**
 * `smoke/dist.ts` 的用例。
 *
 * 浏览器那一段没法在单测里跑（要真 Chrome），所以这里盯**两件在单测里能钉死的事**：
 * ① 静态服务器的行为 —— 尤其是「带扩展名的路径**不许**回退 index.html」（回退会把缺失的 `.js`
 *    变成一坨 HTML，浏览器报 `SyntaxError: Unexpected token '<'`，那是**服务器制造的假异常**）；
 * ② 浏览器发现逻辑 —— 找不到时必须能明确返回"没有"，让上层打 SKIP 而不是抛错。
 *
 * 「打开即死会不会被判红」由负对照实测覆盖（见留档：假产物 → 退出码 1 + "没挂载"）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStaticServer, DEFAULT_DIST, findChrome, MOUNT_TIMEOUT_MS, SPLASH_SELECTOR } from '../dist.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

function makeDist(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'walnut-dist-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  return root
}

describe('常量与判据', () => {
  it('默认产物目录与 splash 选择器是仓里的那一份', () => {
    expect(DEFAULT_DIST).toBe('apps/admin/dist')
    // splash 标记来自 apps/admin/index.html；改了那边要同步这里
    expect(SPLASH_SELECTOR).toBe('.app-loading')
    expect(MOUNT_TIMEOUT_MS).toBeGreaterThan(10_000)
  })
})

describe('findChrome', () => {
  it('cHROME_PATH 优先，且路径不存在时不认', () => {
    expect(findChrome({ CHROME_PATH: process.execPath }, 'linux')).toBe(process.execPath)
    expect(findChrome({ CHROME_PATH: '/definitely/not/here/chrome' }, 'linux')).toBeNull()
  })

  it('找不到时返回 null（上层据此打 SKIP，而不是当成失败）', () => {
    expect(findChrome({}, 'linux')).toBeNull()
  })
})

describe('静态服务器', () => {
  it('伺服真实文件并给出正确 content-type；未知路径回退 index.html（history 模式）', async () => {
    const dist = makeDist({
      'index.html': '<div id="app"></div>',
      'static/js/a.js': 'console.log(1)',
    })
    const server = await createStaticServer(dist)
    try {
      const js = await fetch(`${server.url}static/js/a.js`)
      expect(js.status).toBe(200)
      expect(js.headers.get('content-type')).toContain('javascript')

      const spa = await fetch(`${server.url}some/deep/route`)
      expect(spa.status).toBe(200)
      expect(await spa.text()).toContain('id="app"')
      expect(server.missing).toEqual([])
    }
    finally {
      await server.close()
    }
  })

  it('带扩展名的缺失资源回 404 并记账（不许回退 HTML —— 否则制造假的 SyntaxError）', async () => {
    const dist = makeDist({ 'index.html': '<div id="app"></div>' })
    const server = await createStaticServer(dist)
    try {
      const res = await fetch(`${server.url}static/js/missing.js`)
      expect(res.status).toBe(404)
      // 记的是**请求路径原文**（正斜杠），上层靠它区分"产物缺文件"与"后端资源"
      expect(server.missing).toEqual(['/static/js/missing.js'])
    }
    finally {
      await server.close()
    }
  })
})
