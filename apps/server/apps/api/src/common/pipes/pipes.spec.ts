import type { ArgumentMetadata } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import {
  WalnutAdminPipeAreaPcode,
  WalnutAdminPipeCacheKey,
  WalnutAdminPipeDeviceId,
  WalnutAdminPipeLogFileName,
  WalnutAdminPipeParamEnum,
} from '@walnut-server/pipes'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { describe, expect, it } from 'vitest'
import { AppLoggerLogType } from '@/modules/app/logger/dto/logger.dto'

// 瑕疵修复（2026-10-27）配套单测：裸 param/query 的格式约束管道族 + ParamEnum 的
// optional 形态。管道正则的出处与理由见 libs/pipes/src/base/format.pipe.ts 各类注释。

const PARAM_META: ArgumentMetadata = { type: 'param', metatype: String, data: 'value' }
const QUERY_META: ArgumentMetadata = { type: 'query', metatype: String, data: 'value' }

function errCodeOf(fn: () => unknown): number {
  try {
    fn()
  }
  catch (e) {
    expect(e).toBeInstanceOf(WalnutAdminExceptionBadRequest)
    // getResponse() 的静态类型是 string | object，errCode 形态由基类构造保证
    const response = (e as WalnutAdminExceptionBadRequest).getResponse() as unknown as { errCode: number }
    return response.errCode
  }
  throw new Error('expected the pipe to throw')
}

describe('pipes：WalnutAdminPipeParamEnum（required:false 缺省放行修复）', () => {
  const pipe = new WalnutAdminPipeParamEnum(AppLoggerLogType)

  it('合法值放行', () => {
    expect(pipe.transform('application', PARAM_META)).toBe('application')
    expect(pipe.transform('error', PARAM_META)).toBe('error')
  })

  it('非法值 → 40099', () => {
    expect(errCodeOf(() => pipe.transform('no-such-type', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('required:true（默认）缺值 → 40099', () => {
    expect(errCodeOf(() => pipe.transform(undefined, PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('required:false 缺值放行（修复前 String(undefined) 不在值集被误判「传错」→ 40099）', () => {
    const optional = new WalnutAdminPipeParamEnum(AppLoggerLogType, { required: false })
    expect(optional.transform(undefined, QUERY_META)).toBeUndefined()
    expect(optional.transform('application', QUERY_META)).toBe('application')
    // 缺省放行 ≠ 什么都放行：给了值仍要比对枚举
    expect(errCodeOf(() => optional.transform('nope', QUERY_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

describe('pipes：WalnutAdminPipeDeviceId（sys_device.device_id = HMAC-SHA256 hex 64 位）', () => {
  const pipe = new WalnutAdminPipeDeviceId()
  const valid = 'a'.repeat(64)

  it('64 位 hex 放行（大小写不敏感）', () => {
    expect(pipe.transform(valid, PARAM_META)).toBe(valid)
    expect(pipe.transform(valid.toUpperCase(), PARAM_META)).toBe(valid.toUpperCase())
  })

  it('长度/字符集/路径 payload 一律 40099', () => {
    expect(errCodeOf(() => pipe.transform('short', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform(`${valid}0`, PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('../../etc/passwd'.padEnd(64, 'x'), PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform(undefined, PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

describe('pipes：WalnutAdminPipeAreaPcode（行政区划码 varchar(12) / 顶层 0）', () => {
  const pipe = new WalnutAdminPipeAreaPcode()

  it('"0" 与 1-12 位数字放行', () => {
    expect(pipe.transform('0', PARAM_META)).toBe('0')
    expect(pipe.transform('95', PARAM_META)).toBe('95')
    expect(pipe.transform('950102356012', PARAM_META)).toBe('950102356012')
  })

  it('超长/非数字/路径 payload → 40099', () => {
    expect(errCodeOf(() => pipe.transform('1234567890123', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('abc', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('95 OR 1=1', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

describe('pipes：WalnutAdminPipeCacheKey（WALNUT_CACHE_ 前缀外的显示键形态）', () => {
  const pipe = new WalnutAdminPipeCacheKey()

  it('真实键形态放行（含 uuid / 64 位 hex 后缀）', () => {
    expect(pipe.transform('APP:SETTING', PARAM_META)).toBe('APP:SETTING')
    expect(pipe.transform(`AUTH:MFA:VERIFIED:${'0123abcd'.repeat(8)}:x`, PARAM_META)).toBe(`AUTH:MFA:VERIFIED:${'0123abcd'.repeat(8)}:x`)
    expect(pipe.transform('MONITOR:APISPEC:seed-1:cache', PARAM_META)).toBe('MONITOR:APISPEC:seed-1:cache')
  })

  it('空白/越界长度/特殊字符 → 40099', () => {
    expect(errCodeOf(() => pipe.transform('.hidden', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('a b', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('a'.repeat(129), PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('key\ninjection', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})

describe('pipes：WalnutAdminPipeLogFileName（日志文件名白名单，禁路径分隔符）', () => {
  const pipe = new WalnutAdminPipeLogFileName()

  it('真实文件名形态放行（list 端点产出 + 测试通道自建名）', () => {
    expect(pipe.transform('2026-10-25-15.log', PARAM_META)).toBe('2026-10-25-15.log')
    expect(pipe.transform('2026-10-26-12.log.gz', PARAM_META)).toBe('2026-10-26-12.log.gz')
    expect(pipe.transform('api-spec-3f2a1b9c.log', PARAM_META)).toBe('api-spec-3f2a1b9c.log')
  })

  it('穿越/隐藏文件/非 log 后缀 → 40099', () => {
    expect(errCodeOf(() => pipe.transform('../../package.json', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('..%2F..%2Fpackage.json', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('.hidden.log', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    expect(errCodeOf(() => pipe.transform('2026-10-25-15.txt', PARAM_META))).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })
})
