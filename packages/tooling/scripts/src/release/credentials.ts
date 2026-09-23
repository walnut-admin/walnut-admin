/**
 * GitHub 凭据解析 —— **只用于 git-cliff 调 GitHub API 补 PR 号与作者**。
 *
 * 与参考仓的关键差别（对应本仓的既定决策）：**不落任何本机凭证文件**。
 * 理由：本地不创建 Release（那是 CI 的职责），所以没有「必须持久化一个写权限凭据」的场景；
 * 而「为了 changelog 里多一个 PR 号」不值得在发版机上留一份长期有效的令牌。
 *
 * 来源顺序：`--token` > `GITHUB_TOKEN` > （无）。
 *
 * 未提供 token 时**不是错误**：公开仓匿名查 GitHub API 有 60 次/小时的配额，一次发版够用；
 * 拿不到 PR 号/作者时模板里的守卫会让条目降级为纯 commit 链接（见 cliff.toml）。
 * 需要「缺 token 就硬失败」的场景由 `--require-github-meta` 显式声明。
 */

import type { ReleaseArgs } from './args.ts'
import process from 'node:process'

export interface ResolvedToken {
  token: string | null
  /** 人话来源（日志里只出现掩码 + 这个来源名） */
  source: '--token' | 'GITHUB_TOKEN' | null
}

export function resolveToken(args: ReleaseArgs): ResolvedToken {
  if (args.token)
    return { token: args.token, source: '--token' }
  const fromEnv = process.env.GITHUB_TOKEN?.trim()
  if (fromEnv)
    return { token: fromEnv, source: 'GITHUB_TOKEN' }
  return { token: null, source: null }
}
