#!/usr/bin/env node
import process from 'node:process'
import { main } from '../src/env/setup-env.ts'

process.exit(main(process.argv.slice(2)))
