import type { AppLoggerLogTypeType } from './dto/logger.dto'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import zlib from 'node:zlib'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { getFilterValue } from '@walnut-server/list'
import { normalizeListPage } from '@walnut-server/utils/list-page'
import { clamp, compact, isNil, orderBy } from 'lodash'
import { glob } from 'tinyglobby'
import { AppLoggerDTOListRequest, AppLoggerLogType } from './dto/logger.dto'

async function readLines(filePath: string, start: number, end: number) {
  const isGzip = filePath.endsWith('.gz')
  const fileStream = fsSync.createReadStream(filePath)

  const stream = isGzip
    ? fileStream.pipe(zlib.createGunzip())
    : fileStream

  const rl = readline.createInterface({ input: stream })

  let index = 0
  const result: string[] = []

  for await (const line of rl) {
    if (index >= start && index < end) {
      result.push(line)
    }
    if (++index >= end) {
      rl.close()
      break
    }
  }

  return result
}

@Injectable()
export class AppLoggerService {
  private readonly logger = new Logger(AppLoggerService.name)

  private readonly logFolder = 'logs'
  private readonly pattern = ['**/*.log', '**/*.log.gz']
  private readonly logTypeMap = {
    [AppLoggerLogType.APPLICATION]: 'logs/application',
    [AppLoggerLogType.ERROR]: 'logs/error',
  }

  constructor() { }

  async list(params: AppLoggerDTOListRequest) {
    // 批次 1 · P0：分页入参走共享正规化（`@walnut-server/utils/list-page`）——
    // 本链路不走 SQL，page/pageSize 直接进内存 slice，所以必须在这里也收一遍：
    // pageSize=0 会静默返回空页、负数会让 slice 起点算反。
    const { page, pageSize } = normalizeListPage(params.page)

    // 批次 4-A：过滤条件从 `query` 对象改成显式 filters。本链路的两个过滤字段
    // （fileName / logType）是**文件系统元数据**，不是任何实体的列，没有列类型权威 ——
    // 所以在这里自己裁决：形态不对直接 40099（不静默丢弃，保持与新 wire 同语义）。
    const fileName = this.toFileNameFilter(getFilterValue(params.filters, 'fileName'))
    const logType = this.toLogTypeFilter(getFilterValue(params.filters, 'logType'))

    const cwd = process.cwd()
    const logDir = path.join(cwd, logType ? this.logTypeMap[logType] : this.logFolder)

    // get all log files
    const filePaths = await glob(this.pattern, {
      cwd: logDir,
      absolute: false,
    })

    // get file details
    const logFiles = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const stat = await fs.stat(`${logDir}/${filePath}`)

          return {
            fileName: path.basename(filePath),
            filePath: logType ? `${logType}/${filePath}` : filePath,
            fileSize: stat.size,
            fileMTime: stat.mtime,
            logType: logType || (filePath.includes('error') ? AppLoggerLogType.ERROR : AppLoggerLogType.APPLICATION),
          }
        }
        catch {
          return null
        }
      }),
    )

    // lodash compact filter nulls
    let validFiles = compact(logFiles)

    // file name filter
    if (!isNil(fileName)) {
      validFiles = validFiles.filter(item => item.fileName.toLocaleLowerCase().includes(fileName.toLocaleLowerCase()))
    }

    // lodash order by file mtime desc
    const sortedFiles = orderBy(validFiles, ['fileMTime'], ['desc'])

    const total = sortedFiles.length
    const totalPages = Math.ceil(total / pageSize)
    const currentPage = clamp(page, 1, totalPages || 1)
    const start = (currentPage - 1) * pageSize
    const paginatedFiles = sortedFiles.slice(start, start + pageSize)

    return {
      data: paginatedFiles,
      total,
    }
  }

  /** fileName 过滤值只接受字符串（缺省放行，形态不对 40099） */
  private toFileNameFilter(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined
    }
    if (typeof value !== 'string') {
      throw new WalnutAdminExceptionRequestDataError('filters[fileName] 只接受字符串')
    }
    return value
  }

  /** logType 过滤值只接受枚举内的值（缺省放行，不在枚举里 40099） */
  private toLogTypeFilter(value: unknown): AppLoggerLogTypeType | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined
    }
    if (value !== AppLoggerLogType.APPLICATION && value !== AppLoggerLogType.ERROR) {
      throw new WalnutAdminExceptionRequestDataError('filters[logType] 只能是 application / error')
    }
    return value
  }

  async read(filePath: string, page: number) {
    const cwd = process.cwd()
    const logDir = path.join(cwd, this.logFolder)
    const target = path.join(logDir, filePath)

    // 路径穿越防护（纵深第二道，第一道是 controller 的 logType 枚举 / fileName 白名单
    // 管道）：normalize 后 resolve，必须仍落在 logDir 内，越界（`../` 类 payload）即受控 400
    const resolvedTarget = path.resolve(target)
    const resolvedLogDir = path.resolve(logDir)
    if (!resolvedTarget.startsWith(`${resolvedLogDir}${path.sep}`)) {
      throw new WalnutAdminExceptionRequestDataError(
        `filePath escapes log directory: ${filePath}`,
      )
    }

    const content = await readLines(resolvedTarget, (page - 1) * 30, page * 30)
    return {
      fileName: path.basename(filePath),
      fileContent: content,
      filePath,
    }
  }
}
