#!/usr/bin/env node
// 由 Node 原生执行 `.ts`（Node 24 默认剥离类型）—— 不需要 tsx / ts-node。
// 前提是源码只用**可擦除语法**，由 @walnut/tsconfig/ts.json 的 erasableSyntaxOnly 在编译期保证。
import process from 'node:process'
import { run } from '../src/release/release.ts'

run().catch((error: unknown) => {
  // run() 自己已经把结构化错误的退出码算好了；走到这里说明是它没接住的意外
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`\x1B[31m[release]\x1B[0m ${message}\n`)
  process.exit(1)
})
