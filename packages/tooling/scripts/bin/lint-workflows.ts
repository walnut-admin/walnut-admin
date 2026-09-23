#!/usr/bin/env node
// 由 Node 原生执行 `.ts`（Node 24 默认剥离类型）—— 不需要 tsx / ts-node。
// 前提是源码只用**可擦除语法**，由 @walnut/tsconfig/ts.json 的 erasableSyntaxOnly 在编译期保证。
import process from 'node:process'
import { main } from '../src/ci/lint-workflows.ts'

process.exit(main())
