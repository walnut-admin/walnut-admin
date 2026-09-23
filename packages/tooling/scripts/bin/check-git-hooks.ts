#!/usr/bin/env node
import process from 'node:process'
import { main } from '../src/ci/check-git-hooks.ts'

process.exit(main())
