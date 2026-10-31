import { Injectable } from '@nestjs/common'

@Injectable()
export class SharedBLPathService {
  // 1. 精确匹配列表 (使用 Set，查找速度极快 O(1))
  // 适用于路径完全一致的情况，如静态资源、健康检查端�?
  private readonly exactMatchPaths = new Set<string>([
    '/favicon.ico',
    '/health',
    '/metrics',
  ])

  // 2. 后缀/模糊匹配列表
  // 适用于包含某段路径就跳过的情况，如你�?/state，无论是 /user/state 还是 /app/state 都跳�?
  private readonly suffixMatchPaths = [
    '/state',
    '/heartbeat',
  ]

  /**
   * @description 判断该路径是否应该跳过（不记录日志、不收集风控信息�?
   * @param path 建议传入 req.path
   */
  shouldSkip(path: string): boolean {
    if (!path)
      return false

    // 优先检查精确匹�?(最�?
    if (this.exactMatchPaths.has(path)) {
      return true
    }

    // 其次检查后缀匹配
    return this.suffixMatchPaths.some(suffix => path.endsWith(suffix))
  }
}
