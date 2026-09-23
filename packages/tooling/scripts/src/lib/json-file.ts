/**
 * 读 + 解析 / 写 JSON 的唯一实现（读不到、解析失败、UTF-8 BOM 各有明确归因）。
 *
 * 为什么需要：这套「`readFileSync` + `JSON.parse` + try/catch」被多个脚本各写一遍，而 UTF-8 BOM 被
 * **重新发现三次**（编辑器「UTF-8 with BOM」另存会让 `JSON.parse` 报 `Unexpected token`，文件看着
 * 完全正常）。归到一处后，「读不到」与「解析失败」的口径只有一种答案。
 * 失败口径：`readJson` 对「文件不存在」与「内容不是合法 JSON」返回 `null`（**不抛**）—— 这两件事在
 * 调用点常常是同一个分支（没有状态文件 = 全新开始）；其余错误（权限、EISDIR）同样收敛成 `null`。
 * 不做什么：不做 schema / 形状校验（那是各调用点的判据）、不读 JSONC（注释与尾逗号归 TS 家族）。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 吃掉 UTF-8 BOM：编辑器「UTF-8 with BOM」另存后 `JSON.parse` 会报 `Unexpected token` */
function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

/** 读 JSON；读不到或解析不了都返回 `null`（这两种情况本函数**永不抛**） */
export function readJson<T = unknown>(path: string): T | null {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  }
  catch {
    return null
  }
  try {
    return JSON.parse(stripBom(text)) as T
  }
  catch {
    return null
  }
}

/** 写 JSON：自动建父目录，结尾补一个换行（POSIX 文本文件约定，也让 git diff 干净） */
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
