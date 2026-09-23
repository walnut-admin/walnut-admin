/**
 * 子进程输出的尾部缓冲（纯逻辑）—— 失败时能补的只有「退出码 1」是不够的：
 * 报错正文早被心跳与后续输出冲到屏幕外，用户既不知道哪一项失败，也没法提 bug。
 */

import { describe, expect, it } from 'vitest'
import { renderFailureTail, TailBuffer } from '../child-output.ts'

describe('尾行缓冲 TailBuffer —— 只留最后 N 行，但报出真实总数', () => {
  it('只保留最后 limit 行，total 仍是见过的全部行数', () => {
    const buffer = new TailBuffer(3)
    buffer.push('a\nb\nc\nd')
    expect(buffer.lines()).toEqual(['b', 'c', 'd'])
    expect(buffer.total()).toBe(4)
  })

  it('一块 chunk 常含多行；跨多次 push 连续计账', () => {
    const buffer = new TailBuffer(2)
    buffer.push('1\n2\n')
    buffer.push('3\n4\n')
    expect(buffer.lines()).toEqual(['3', '4'])
    expect(buffer.total()).toBe(4)
  })

  it('空行不计（它们只占位置、不携带信息）', () => {
    const buffer = new TailBuffer(5)
    buffer.push('\n\n   \n\t\n')
    expect(buffer.lines()).toEqual([])
    expect(buffer.total()).toBe(0)
  })

  it('行内空白保留（只有「整行是空白」才被丢掉）', () => {
    const buffer = new TailBuffer(5)
    buffer.push('  缩进的两格  \n')
    expect(buffer.lines()).toEqual(['  缩进的两格  '])
    expect(buffer.total()).toBe(1)
  })

  it('lines() 返回拷贝：调用方改不动内部状态', () => {
    const buffer = new TailBuffer(2)
    buffer.push('a\nb\n')
    const snapshot = buffer.lines()
    snapshot.push('被污染的')
    expect(buffer.lines()).toEqual(['a', 'b'])
  })

  it('limit 非正数时回落到缺省的 60 行', () => {
    const buffer = new TailBuffer(0)
    buffer.push(Array.from({ length: 70 }, (_, index) => `line-${index + 1}`).join('\n'))
    expect(buffer.total()).toBe(70)
    expect(buffer.lines()).toHaveLength(60)
    expect(buffer.lines()[0]).toBe('line-11')
    expect(buffer.lines().at(-1)).toBe('line-70')
  })

  it('没到上限时全部保留', () => {
    const buffer = new TailBuffer(60)
    buffer.push('only line\n')
    expect(buffer.lines()).toEqual(['only line'])
    expect(buffer.total()).toBe(1)
  })
})

describe('renderFailureTail —— 失败时重播的那段', () => {
  it('只取最后 N 行并逐行缩进', () => {
    expect(renderFailureTail(['a', 'b', 'c'], 2)).toBe('   ── 失败前的最后 2 行输出 ──\n   b\n   c')
  })

  it('行数少于上限时按实际条数说明', () => {
    expect(renderFailureTail(['only'], 60)).toBe('   ── 失败前的最后 1 行输出 ──\n   only')
  })

  it('max <= 0 时不做截断', () => {
    expect(renderFailureTail(['a', 'b'], 0)).toBe('   ── 失败前的最后 2 行输出 ──\n   a\n   b')
  })

  it('没有输出时明确说一句（留空白会让人以为是脚本自己吞了输出）', () => {
    expect(renderFailureTail([])).toBe('   （子进程没有输出任何内容）')
    expect(renderFailureTail([], 10)).toBe('   （子进程没有输出任何内容）')
  })
})
