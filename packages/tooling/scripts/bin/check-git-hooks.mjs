#!/usr/bin/env node
import process from 'node:process'
import { main } from '../src/ci/check-git-hooks.ts'
import 'tsx/esm'

process.exit(main())
