/**
 * `check-source-secrets.ts` 的用例。
 *
 * 这份用例的重点不是"规则对不对"（那在 `check-dist-secrets.test.ts` 里，两边共用同一份规则表），
 * 而是**这道门禁自己的三个失效模式**：
 *   1. 扫描面为空却报绿（所以有一条断言「真的扫到了上千个文件」）；
 *   2. 只扫跟踪面 ⇒ 刚写下、还没 `git add` 的夹具漏掉（所以用 `lsFilesWithUntracked`，
 *      并用**临时未跟踪文件**做负对照）；
 *   3. 大文件被静默跳过（所以跳过的文件要被报出来，不静默）。
 */
import { Buffer } from 'node:buffer'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPO_ROOT } from '../../lib/repo-root.ts'
import { collectFindings, MAX_FILE_BYTES, scanSourceText, SOURCE_TEXT_FILE } from '../check-source-secrets.ts'

/** 与 `check-dist-secrets.test.ts` 同一套拼装写法：假样本也不许长成真凭据的形状 */
const fakeTencentAk = `AKID${'x'.repeat(32)}`
const fakeAwsAk = `AKIA${'IOSFODNN7EXAMPLE'}`

describe('sOURCE_TEXT_FILE —— 后缀表把 `.ts` 这类源码也包进来', () => {
  it('源码 / 文档 / 配置都在扫描面里', () => {
    for (const f of ['a.ts', 'a.vue', 'a.md', 'a.yaml', 'a.sh', 'a.json', 'dir/b.tsx'])
      expect(SOURCE_TEXT_FILE.test(f), f).toBe(true)
  })

  it('二进制 / 压缩产物不在扫描面里（不读它们）', () => {
    for (const f of ['a.png', 'a.br', 'a.gz', 'a.woff2', 'a.mp3'])
      expect(SOURCE_TEXT_FILE.test(f), f).toBe(false)
  })

  // 产物侧的后缀表里**没有 `.ts`** —— 我那次翻车正落在 `.ts` 夹具上，这条钉住两边的差别
  it('产物侧的 TEXT_FILE 不包含 .ts（这就是源码侧要单独存在的原因）', () => {
    // 动态引入避免与上面那条断言混在一起
    return import('../check-dist-secrets.ts').then(({ TEXT_FILE }) => {
      expect(TEXT_FILE.test('a.js')).toBe(true)
      expect(TEXT_FILE.test('a.ts')).toBe(false)
    })
  })
})

describe('scanSourceText —— 报位置（行号）', () => {
  it('报出 1-based 行号', () => {
    const text = `第一行\n第二行\nconst ak = '${fakeTencentAk}'\n第四行\n`
    const [finding] = scanSourceText(text, 'x.ts')
    expect(finding!.line).toBe(3)
    expect(finding!.rule).toBe('cloud-access-key')
  })

  // ⚠️ 每条规则**只报第一处**（见 `scanText` 的注释：门禁只需要红，重复命中会刷屏）。
  // 这条断言把那个行为钉住，免得有人以为"报了 1 处 = 只有 1 处"。
  it('同一文件里同一条规则命中多处时，只报第一处', () => {
    const text = `${fakeAwsAk}\n\n${fakeTencentAk}\n`
    expect(scanSourceText(text, 'x.ts').map(f => f.line)).toEqual([1])
  })

  it('不同规则各自报第一处', () => {
    const text = `${fakeAwsAk}\n${['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.')}\n`
    expect(scanSourceText(text, 'x.ts').map(f => `${f.rule}@${f.line}`)).toEqual(['cloud-access-key@1', 'jwt@2'])
  })
})

describe('collectFindings —— 对着真实仓库跑', () => {
  const result = collectFindings(REPO_ROOT)

  it('本仓当前干净（含文档里的格式说明 —— 那条规则已按实测收窄）', () => {
    expect(result.findings.map(f => `${f.file}:${f.line} [${f.rule}]`)).toEqual([])
  })

  it('扫描面不是空的（空面 ⇒ 断言失效，不是「全都对」）', () => {
    expect(result.total, 'git ls-files 没给出文件').toBeGreaterThan(500)
    expect(result.scanned, '文本文件一个都没扫到 ⇒ 后缀表写错了').toBeGreaterThan(500)
  })

  it('没有超过上限而被静默跳过的文件（跳过了也会报出来，这里钉住当前没有）', () => {
    expect(result.skippedTooLarge).toEqual([])
  })

  it('本仓最大的那几个文本文件都在上限之内（上限不是摆设）', () => {
    const lock = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8')
    expect(Buffer.byteLength(lock)).toBeLessThan(MAX_FILE_BYTES)
  })
})

describe('负对照：未跟踪的新文件也会被扫到（这道门禁的价值全在 push 之前）', () => {
  it('刚写下、还没 git add 的夹具文件同样会命中', () => {
    // 在**真实仓库里**造一个未跟踪文件，跑完立刻删掉（`--others --exclude-standard` 会带上它）
    const rel = `.tmp-secret-probe-${Date.now()}.ts`
    const abs = path.join(REPO_ROOT, rel)
    try {
      writeFileSync(abs, `const leaked = '${fakeTencentAk}'\n`)
      const hit = collectFindings(REPO_ROOT).findings.filter(f => f.file === rel)
      expect(hit, '未跟踪文件没被扫到 ⇒ lsFilesWithUntracked 用错了').toHaveLength(1)
      expect(hit[0]!.line).toBe(1)
    }
    finally {
      rmSync(abs, { force: true })
    }
    // 删掉之后必须回到干净 —— 否则说明上面那次探测污染了结论
    expect(collectFindings(REPO_ROOT).findings).toEqual([])
  })

  it('夹具在别处（临时目录）时不会误报仓库', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'walnut-src-'))
    try {
      writeFileSync(path.join(dir, 'x.ts'), `const leaked = '${fakeTencentAk}'\n`)
      expect(collectFindings(REPO_ROOT).findings).toEqual([])
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
