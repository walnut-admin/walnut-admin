import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import zlib from 'node:zlib'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
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
    const { page, pageSize } = params.page
    const { fileName, logType } = params.query

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
