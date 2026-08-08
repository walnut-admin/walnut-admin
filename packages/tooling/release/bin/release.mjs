#!/usr/bin/env node
import process from 'node:process'
import { main } from '../src/release.ts'
import 'tsx/esm'

main().catch((err) => {
  console.error('\x1B[31m[release]\x1B[0m', err.message)
  process.exit(1)
})
