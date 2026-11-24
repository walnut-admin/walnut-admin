/* eslint-disable no-template-curly-in-string -- 夹具要构造的是**字面量**的模板插值文本，不是 JS 模板串 */
import { describe, expect, it } from 'vitest'
import { scanSource, stripComments, templateEnd } from '../check-dynamic-imports.ts'

/** 便捷断言：把一段源码喂进去，取 (kind:line) 列表 */
function hits(src: string) {
  return scanSource('apps/fake/x.ts', src).map(f => `${f.kind}:${f.line}`)
}

describe('stripComments —— 抹注释但保留字符串与偏移', () => {
  it('行注释被抹成等长空白，换行保留', () => {
    const src = 'a // import(`${x}`)\nb'
    const out = stripComments(src)
    expect(out.length).toBe(src.length)
    expect(out.split('\n').length).toBe(2)
    expect(out).not.toContain('//')
  })

  it('块注释被抹掉，且注释里的反引号不会把状态机带偏', () => {
    const src = '/* import(`${key}`) `trap` */\nconst real = 1'
    const out = stripComments(src)
    expect(out).not.toContain('trap')
    expect(out).toContain('const real = 1')
  })

  it('字符串里的 // 不算注释（否则后面整行会被抹掉）', () => {
    const src = 'const url = "http://x/y"\nimport(`./a`)'
    const out = stripComments(src)
    expect(out).toContain('import(`./a`)')
  })
})

describe('scanSource —— 只报「bundler 无法静态解析」的两种形态', () => {
  it('字符串字面量 import：放行', () => {
    expect(hits('const a = () => import(\'./a\')')).toEqual([])
    expect(hits('const a = () => import("./a")')).toEqual([])
  })

  it('纯模板字面量（无插值）：放行（等价常量）', () => {
    expect(hits('const a = () => import(`@/views/a.vue`)')).toEqual([])
  })

  it('模板插值：报 template', () => {
    expect(hits('const a = (k) => import(`../../${k}/index.ts`)')).toEqual(['template:1'])
  })

  it('非字面量说明符：报 non-literal', () => {
    expect(hits('const a = (p) => import(p)')).toEqual(['non-literal:1'])
    expect(hits('const a = () => import(someVariable)')).toEqual(['non-literal:1'])
  })

  it('注释里的旧写法不报（否则门禁会对着文档开火）', () => {
    const src = [
      '/**',
      ' * 旧实现是 import(`../../${key}/index.ts`)',
      ' */',
      'export const ok = 1',
    ].join('\n')
    expect(hits(src)).toEqual([])
  })

  it('行号按原始源码计算（注释抹成空白后不会漂）', () => {
    const src = ['// one', '// two', 'const a = (k) => import(`./${k}`)'].join('\n')
    expect(hits(src)).toEqual(['template:3'])
  })

  it('多行模板字面量也能配对（templateEnd 不误伤）', () => {
    const src = ['const a = (k) => import(`', '  ./${k}', '`)'].join('\n')
    expect(hits(src)).toEqual(['template:1'])
  })

  it('字符串正文里的 import() 不报（ESLint message 那类）', () => {
    const src = 'const rule = { message: "libs 内禁止动态 import（含模板串）；确需按需加载时在评审中显式豁免。" }'
    expect(hits(src)).toEqual([])
    expect(hits('const msg = "禁止 import() 与 import(x)"')).toEqual([])
  })

  it('obj.import(x) 是属性访问，不报（R3 P2-a 的误报）', () => {
    expect(hits('const y = obj.import(x)')).toEqual([])
    expect(hits('const y = obj . import(x)')).toEqual([])
    expect(hits('const y = obj?.import(x)')).toEqual([])
  })

  it('import.meta.glob 不是 import() 形态，不报', () => {
    expect(hits('const m = import.meta.glob(\'./views/**/*.vue\')')).toEqual([])
  })
})

describe('templateEnd', () => {
  it('返回配对的反引号下标', () => {
    const src = '`a b`c'
    expect(templateEnd(src, 0)).toBe(4)
  })
})
