import type { ArgumentsHost } from '@nestjs/common'
import { HttpStatus, Logger } from '@nestjs/common'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { I18nContext } from 'nestjs-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WalnutAdminExceptionBadRequest, WalnutAdminExceptionInternalServerError, WalnutAdminExceptionUnauthorized } from '../base.exception'
import { shouldReportException, WalnutAdminFilterExceptionAll } from '../exception.filter'

/**
 * F-13：全局异常过滤器的入库判据。
 *
 * 改造前是「所有异常都入 Bull → DB」（只有 AppErrorService 内部一份 code 白名单 40000/40099/50000/50001
 * 兜着），等于把「用户输错密码」「令牌过期」「MFA 待验证」「被风控拦下」这类 4xx 也往错误表里堆，
 * 真故障（5xx）被噪声埋掉。现在判据上移到过滤器：只有 5xx / 未预期异常入库。
 *
 * 这组用例同时守两件事：
 * 1. shouldReportException 的纯判据（4xxxx false / 5xxxx true / 判不出来时保守 true）；
 * 2. 过滤器真的按它分流 —— 4xxxx 不回落到 reporter，50000 一定回落到 reporter；以及 blpath
 *    skip 名单（favicon、health、metrics，以及以 /state 与 /heartbeat 结尾的路径）仍然优先于入库。
 */

const RequestPath = '/w/v1/app/demo/list'

interface IReporterSpy {
  addErrorQueue: ReturnType<typeof vi.fn>
}

function createRequest() {
  return {
    id: 'req-f13',
    url: RequestPath,
    path: RequestPath,
    method: 'GET',
    realIp: '203.0.113.7',
    headers: {},
    body: {},
    params: {},
    query: {},
    timezone: 'UTC',
    language: 'zh-CN',
    version: '1',
    repoVersion: 'test',
  }
}

function createHost(request: ReturnType<typeof createRequest>) {
  const response = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  }

  response.status.mockImplementation(() => response)

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost

  return { host, response }
}

function createFilter(options: { skip?: boolean } = {}) {
  const reporter: IReporterSpy = { addErrorQueue: vi.fn().mockResolvedValue(true) }
  const blPath = { shouldSkip: vi.fn().mockReturnValue(options.skip ?? false) }

  const filter = new WalnutAdminFilterExceptionAll(
    blPath as unknown as ConstructorParameters<typeof WalnutAdminFilterExceptionAll>[0],
    reporter as unknown as ConstructorParameters<typeof WalnutAdminFilterExceptionAll>[1],
  )

  return { filter, reporter, blPath }
}

describe('shouldReportException：只有 5xx / 未预期异常入库', () => {
  it('4xxxx（客户端可自愈）一律不入库', () => {
    const clientCodes = [
      WalnutAdminConstAppResponseCode.BAD_REQUEST,
      WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR,
      WalnutAdminConstAppResponseCode.UNAUTHORIZED,
      WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_REQUIRED,
      WalnutAdminConstAppResponseCode.FORBIDDEN,
      WalnutAdminConstAppResponseCode.NOT_FOUND,
      WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED,
      WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BLACK_LIST_PATH_DETECTED,
      WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS,
    ]

    for (const code of clientCodes)
      expect(shouldReportException(code)).toBe(false)
  })

  it('5xxxx（服务端 / 依赖故障）入库', () => {
    const serverCodes = [
      WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR,
      WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR_DATABASE,
      WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE,
      WalnutAdminConstAppResponseCode.GATEWAY_TIMEOUT,
    ]

    for (const code of serverCodes)
      expect(shouldReportException(code)).toBe(true)
  })

  it('判不出响应码时保守入库（宁可多一条，不漏真故障）', () => {
    expect(shouldReportException(undefined)).toBe(true)
    expect(shouldReportException(Number.NaN)).toBe(true)
  })
})

describe('全局异常过滤器：按判据分流', () => {
  let loggerError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
    vi
      .spyOn(I18nContext, 'current')
      .mockReturnValue({ t: (key: string) => key } as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('4xxxx 业务异常（40000）不入队，但异常壳照常落响应', async () => {
    const { filter, reporter } = createFilter()
    const request = createRequest()
    const { host, response } = createHost(request)

    await filter.catch(new WalnutAdminExceptionBadRequest({ errMsg: 'response.40000' }), host)

    expect(reporter.addErrorQueue).not.toHaveBeenCalled()
    expect(response.status).toHaveBeenCalledWith(HttpStatus.OK)
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: WalnutAdminConstAppResponseCode.BAD_REQUEST }),
    )
  })

  it('未认证 / MFA 待验证（40114）不入队', async () => {
    const { filter, reporter } = createFilter()
    const { host } = createHost(createRequest())

    await filter.catch(
      new WalnutAdminExceptionUnauthorized({
        errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_REQUIRED,
      }),
      host,
    )

    expect(reporter.addErrorQueue).not.toHaveBeenCalled()
  })

  it('未预期 Error（兜底 50000）入队一次', async () => {
    const { filter, reporter } = createFilter()
    const request = createRequest()
    const { host } = createHost(request)
    const exception = new Error('boom')

    await filter.catch(exception, host)

    expect(reporter.addErrorQueue).toHaveBeenCalledTimes(1)
    expect(reporter.addErrorQueue).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ code: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR }),
      HttpStatus.OK,
      exception,
    )
  })

  it('显式 5xx 异常（50000）同样入队', async () => {
    const { filter, reporter } = createFilter()
    const { host } = createHost(createRequest())

    await filter.catch(new WalnutAdminExceptionInternalServerError(), host)

    expect(reporter.addErrorQueue).toHaveBeenCalledTimes(1)
  })

  it('blpath skip 名单优先：命中时不入队也不打错误日志（即便 50000）', async () => {
    const { filter, reporter } = createFilter({ skip: true })
    const { host } = createHost(createRequest())

    await filter.catch(new Error('health probe noise'), host)

    expect(reporter.addErrorQueue).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('5xx 且未命中 skip 名单时错误日志照常打', async () => {
    const { filter } = createFilter()
    const { host } = createHost(createRequest())

    await filter.catch(new Error('boom'), host)

    expect(loggerError).toHaveBeenCalledTimes(1)
  })
})
