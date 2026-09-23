#!/usr/bin/env node
import process from 'node:process'
import { run } from '../src/release/release.ts'
// tsx/esm 必须在 .ts import **之前**：它注册 loader，后置则 .ts 的解析要靠 Node 的
// 原生类型剥离（Node 24 默认开启，但只在「可擦除语法」范围内成立）。先注册最稳。
import 'tsx/esm'

run().catch((error) => {
  // run() 自己已经把结构化错误的退出码算好了；走到这里说明是它没接住的意外
  process.stderr.write(`\x1B[31m[release]\x1B[0m ${error?.message ?? error}\n`)
  process.exit(1)
})
