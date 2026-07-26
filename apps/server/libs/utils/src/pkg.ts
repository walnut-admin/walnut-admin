import type { Recordable } from 'easy-fns-ts'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export function getPackageJsonData(): Recordable {
  try {
    const packageJsonPath = path.resolve(process.cwd(), 'package.json')
    const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8')
    const packageJsonObject = JSON.parse(packageJsonContent) as Recordable
    return packageJsonObject
  }
  catch (error) {
    console.error('package.json read error:', error)
    return {}
  }
}
