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
    // F-16：此处**保留** console —— 本函数在模块求值期被调用（`libs/config` 的
    // middleware.config.ts、`libs/cookie` 的 cookie.service.ts 都在模块顶层调
    // `getPackageJsonData()`），早于 `app.useLogger()` 装自定义 Logger 的时机；那时 Nest
    // Logger 只会退回默认 ConsoleLogger、写同一处 stderr —— 换过去拿不到 requestId / 轮转，
    // 只是把同一条启动期兜底信息换个 API 写。运行期调用方（app.service / logger 模块）要进
    // 管道日志，应在自己的调用点记。
    console.error('package.json read error:', error)
    return {}
  }
}
