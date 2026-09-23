#!/usr/bin/env node
import process from 'node:process'
import { main } from '../src/ci/lint-workflows.ts'
import 'tsx/esm'

process.exit(main())
