/**
 * 兜底脱敏 CLI：把一份日志文件整份过 {@link redactText}，**原子写回**（临时文件 + rename）。
 *
 * 谁用：CI 上传 artifact 之前（`if: always()` 的那一步）。主路径的脱敏在
 * `scripts/start-backend.ts` 的写入处已经做过 —— 这一层防的是「包装脚本没跑成」「文件被别的
 * 路径写脏」「将来有人往 test-results 里加日志却忘了接脱敏」三类情况。artifact 一旦上传就不
 * 可收回，所以多跑一遍的成本（毫秒级）值得。
 *
 * 用法：`node scripts/redact-log.ts <log-file>`。文件不存在 ⇔ 这一轮没有后端日志（webServer
 * 没起来 / 用例在更早的阶段失败）—— 打印 notice 并成功退出，不要让兜底步骤自己变成噪音。
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { redactText } from '../lib/redact.ts'

function main(): void {
  const target = process.argv[2]
  if (target === undefined || target === '') {
    console.error('[e2e/redact-log] 用法：node scripts/redact-log.ts <log-file>')
    process.exitCode = 2
    return
  }

  if (!existsSync(target)) {
    console.log(`[e2e/redact-log] ${target} 不存在，跳过（这一轮没有产生该日志）`)
    return
  }

  const original = readFileSync(target, 'utf8')
  const redacted = redactText(original)
  if (redacted === original) {
    console.log(`[e2e/redact-log] ${target} 无需改动（没有命中脱敏规则）`)
    return
  }

  const tmp = `${target}.redacted`
  try {
    writeFileSync(tmp, redacted, 'utf8')
    renameSync(tmp, target)
  }
  catch (error) {
    rmSync(tmp, { force: true })
    throw error
  }
  console.log(`[e2e/redact-log] ${target} 已重新脱敏（多杀 ${original.length - redacted.length} 字符）`)
}

try {
  main()
}
catch (error) {
  console.error(`[e2e/redact-log] 失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
