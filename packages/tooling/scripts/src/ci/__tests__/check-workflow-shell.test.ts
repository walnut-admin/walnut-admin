/* eslint-disable no-template-curly-in-string -- 这套用例的**被测对象**就是 `${{ … }}` 这类 GitHub 表达式字面量（在普通字符串里写 `${{` 正是这条规则要防的误写，这里是刻意为之） */
/**
 * workflow shell 门禁的用例。
 *
 * 三条判据都要能**证明自己会红**（这道闸的价值全在"能拦住"上）：
 * ① 抽取器真的从 YAML 里抓到 `run:` / `with.script:`（抓不到就永远绿 —— 假闸）；
 * ② `${{ … }}` 必须先中性化，否则任何用 secrets 的 workflow 都会以 `bad substitution` 误报；
 * ③ 断言的平台判定可注入（仓库里那几条教训：宿主装没装 bash / 路径语义是环境事实，不能写死）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import { checkWithBash, collectShellBlocks, findBash, listWorkflows, neutralizeExpressions } from '../check-workflow-shell.ts'

const SAMPLE = `
name: Sample
on: push
jobs:
  a:
    steps:
      - name: 一步
        run: |
          echo hello
          echo world
      - name: ssh
        uses: appleboy/ssh-action@v0.1.10
        with:
          script: |
            set -e
            echo inside
      - name: 用 secrets
        run: echo "token=\${{ secrets.TOKEN }}"
`

describe('collectShellBlocks —— 抽取', () => {
  it('抓到 `run:` 与 `with.script:`，且带上步骤名便于定位', () => {
    const blocks = collectShellBlocks(SAMPLE, 'sample.yml')
    expect(blocks).toHaveLength(3)
    expect(blocks[0].script).toBe('echo hello\necho world')
    expect(blocks[0].where).toContain('一步')
    expect(blocks[1].script).toContain('echo inside')
    expect(blocks[1].where).toContain('ssh')
  })

  it('没有 shell 的 workflow 抽出空数组（不是报错）', () => {
    expect(collectShellBlocks('name: X\non: push\njobs: {}\n', 'x.yml')).toEqual([])
  })
})

describe('neutralizeExpressions —— ${{ }} 必须先中性化', () => {
  it('把表达式换成裸词占位符', () => {
    expect(neutralizeExpressions('echo "${{ secrets.X }}" > "${{ steps.y.outputs.z }}"'))
      .toBe('echo "__GH_EXPR__" > "__GH_EXPR__"')
  })

  it('跨行的表达式也吃得下（`${{` 必须相邻，换行只允许在花括号之内）', () => {
    expect(neutralizeExpressions('a ${{ \n  x\n }}\nb')).toBe('a __GH_EXPR__\nb')
  })
})

describe('findBash —— 平台判定可注入', () => {
  it('bASH_PATH 优先', () => {
    expect(findBash({ BASH_PATH: '/opt/bash' }, 'linux', () => true)).toBe('/opt/bash')
  })

  it('按平台给候选：win32 与 posix 各一条', () => {
    expect(findBash({}, 'win32', p => p.endsWith('bash.exe'))).toContain('bash.exe')
    expect(findBash({}, 'linux', p => p === '/bin/bash')).toBe('/bin/bash')
  })

  it('找不到返回 null（上层据此 SKIP，而不是假装红）', () => {
    expect(findBash({}, 'linux', () => false)).toBeNull()
  })
})

describe('checkWithBash —— 真跑 bash -n', () => {
  const bash = findBash()
  const run = bash === null ? it.skip : it

  run('语法错能报出来（负对照）', () => {
    expect(checkWithBash(bash!, 'if [ 1 = 1 ; then\n  echo oops\n')).not.toBeNull()
  })

  run('合法脚本返回 null', () => {
    expect(checkWithBash(bash!, 'set -e\necho ok\n')).toBeNull()
  })

  run('heredoc 形态也认（这次线上踩的就是它）', () => {
    expect(checkWithBash(bash!, 'docker compose exec -T svc sh -s "$DB" <<\'INNER\'\nset -e\necho "$1"\nINNER\n')).toBeNull()
  })
})

describe('真实仓库上跑一遍（防这道闸变成假绿）', () => {
  const bash = findBash()

  // 这两条扫**真实仓库**、且每段 shell 都要 spawn 一次 bash：本机（Windows）实测约 6 秒，
  // 而 vitest 默认上限 5 秒 —— 2026-09-30 实测它就超时了（同一个坑 doc-refs 那套也踩过）。
  // 要守的判据是"有没有语法错"，不是"能不能 5 秒跑完"。
  it('至少抽到 20 段 shell 块（抽不到就说明抽取器坏了）', () => {
    const files = listWorkflows(REPO_ROOT)
    expect(files.length).toBeGreaterThanOrEqual(3)
    const total = files.reduce((sum, file) => sum + collectShellBlocks(readFileSync(join(REPO_ROOT, file), 'utf8'), file).length, 0)
    expect(total).toBeGreaterThanOrEqual(20)
  }, 30_000)

  it.runIf(bash !== null)('当前仓库所有 shell 块语法通过', () => {
    const files = listWorkflows(REPO_ROOT)
    const failures = files.flatMap(file => collectShellBlocks(readFileSync(join(REPO_ROOT, file), 'utf8'), file)
      .map(block => ({ block, error: checkWithBash(bash!, block.script) }))
      .filter(item => item.error !== null))
    expect(failures.map(f => `${f.block.where}: ${f.error}`)).toEqual([])
  }, 30_000)
})
