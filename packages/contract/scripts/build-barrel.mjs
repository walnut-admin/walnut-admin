import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const distDir = join(import.meta.dirname, '..', 'dist')
const files = readdirSync(distDir).filter(f => f.endsWith('.cjs') && f !== 'index.cjs')

// Generate barrel that re-exports everything from sub-modules
const lines = ['"use strict";', '']
for (const file of files) {
  const modName = file.replace('.cjs', '')
  const varName = `__${modName.replace(/-/g, '_')}`
  lines.push(`var ${varName} = require('./${file}');`)
  lines.push(`Object.keys(${varName}).forEach(function(k) { exports[k] = ${varName}[k]; });`)
  lines.push('')
}

writeFileSync(join(distDir, 'index.cjs'), lines.join('\n'))
