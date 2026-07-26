import type { Recordable } from 'easy-fns-ts'
import { isDev } from '@walnut/config/utils/env'

import { loggerContextALS } from '@walnut/context'
import { getPackageJsonData } from '@walnut/utils/pkg'
import { isNil } from 'lodash'
import { utilities, WinstonModule } from 'nest-winston'
import * as winston from 'winston'
import 'winston-daily-rotate-file'

const AppName = getPackageJsonData().name as string

/**
 * 【核心修复器�?
 * 专门解决 NestJS Logger 将元数据对象塞入 context 参数导致的格式错乱问题�?
 * 它会检�?context 是否为对象，如果是，则将其内部字段提升到根层级�?
 */
const normalizeNestContextFormat = winston.format((info) => {
  // 只有�?context 是对象（且不是字符串、null、undefined）时才处�?
  if (typeof info.context === 'object') {
    const meta = info.context as Recordable

    // 1. 提取真正�?context 类名 (例如 "LoggerMiddleware")
    if (!isNil(meta.context)) {
      info.context = meta.context
    }

    // 2. �?request, response, requestId, type 等元数据提升到根层级
    // 遍历对象，把除了 'context' 以外的所�?key 合并�?info 根对象上
    Object.keys(meta).forEach((key) => {
      if (key !== 'context') {
        info[key] = meta[key]
      }
    })
  }
  return info
})()

// --- 1. 终端输出格式 (仅供人看，纯净、无JSON) ---
const consoleLogFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.ms(),
  normalizeNestContextFormat,
  utilities.format.nestLike(AppName, {
    colors: true,
    prettyPrint: true,
    processId: true,
    appName: true,
  }),
)

// --- 2. 文件输出格式 (�?JSON，给机器�? ---
const fileJsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  normalizeNestContextFormat,

  // 【核心】手动重排序并注�?requestId
  winston.format.printf((info) => {
    const store = loggerContextALS.getStore()
    if (!store) {
      return JSON.stringify(info)
    }

    if (store?.requestId && isNil(info.requestId)) {
      info.requestId = store.requestId
    }

    // 解构
    const {
      timestamp,
      level,
      message,
      context,
      requestId,
      type,
      request,
      response,
      error,
      stack,
      ...rest
    } = info as {
      timestamp: string
      level: string
      message: string
      context: string
      requestId: string
      type: string
      request: string
      response: string
      error: Error
      stack: string
    }

    // 构建有序对象
    const orderedInfo: Recordable = {
      timestamp,
      level,
      message,
      context,
      requestId,
    }

    if (type)
      orderedInfo.type = type
    if (request)
      orderedInfo.request = request
    if (response)
      orderedInfo.response = response

    // Error �?Stack 放最�?
    if (!isNil(error))
      orderedInfo.error = error
    if (stack && (isNil(error) || isNil(error.stack)))
      orderedInfo.stack = stack

    if (Object.keys(rest).length > 0) {
      Object.assign(orderedInfo, rest)
    }

    // 【关键】手动转 JSON，不依赖 winston.format.json()
    // 这里保证�?orderedInfo 的顺序会被原封不动地写入文件
    return JSON.stringify(orderedInfo)
  }),
)

function createDailyRotateTransport(level: string, filename: string) {
  return new winston.transports.DailyRotateFile({
    level,
    dirname: `logs/${filename}`,
    filename: `%DATE%.log`,
    datePattern: 'YYYY-MM-DD-HH',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '14d',
    // 【关键】这里使用纯 JSON 格式
    format: fileJsonFormat,
  })
}

export const WalnutAdminLogger = WinstonModule.createLogger({
  // 默认级别
  level: isDev ? 'debug' : 'info',
  transports: [
    // 终端：使用美化格�?
    new winston.transports.Console({
      format: consoleLogFormat,
    }),
    // 文件：使�?JSON 格式
    createDailyRotateTransport('info', 'application'),
    createDailyRotateTransport('warn', 'error'),
  ],
})
