import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { SysDeviceDTOInitialRequest } from './device.dto'

/**
 * P4（批次 11 / B5 收尾）：`deviceName` 从 `POST /system/device/initial` 的 wire 契约**摘除**的
 * 机械钉。
 *
 * 为什么必须摘：B5 起设备名由**服务端生成**（`<设备类型>_<8 位随机 hex>`，见
 * SysDeviceService.buildServerDeviceName）—— 名字的唯一性（uq_device_name 全局唯一）必须由
 * 签发方保证。DTO 里留一个「可传但无效」的字段等于让契约撒谎。
 *
 * 为什么在这里钉而不是 api-spec：`initial` 有 4 次/60s 的限流（42900），device.api-spec
 * 的调用数已经压在上限 —— 再补一条 HTTP 用例会把整文件推到限流边缘。这里用**与全局
 * ValidationPipe 同口径**的校验（main.ts 的 whitelist + forbidNonWhitelisted）直接证：
 * 带 `deviceName` 的载荷必然产出 `whitelistValidation` 错误（线上即 40099）。
 *
 * 负对照：把 `deviceName` 加回 RealPickType 的键列表，第二个用例会红。
 */

/** 与全局 ValidationPipe 同口径（apps/api/src/main.ts） */
async function validateLikePipe(target: ClassConstructor<object>, body: Record<string, unknown>) {
  const instance = plainToInstance(target, body)
  return validate(instance, {
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  })
}

/** 真实客户端（api-client 引导）现在发的载荷：只含 wire 契约里剩下的字段 */
const VALID_BODY = {
  deviceInfo: {},
  hardwareInfo: {},
  sr: { height: 1080, width: 1920 },
  vp: { height: 900, width: 1600 },
  private: false,
}

describe('sysDeviceDTOInitialRequest：deviceName 已不在入参白名单（P4）', () => {
  it('不带 deviceName 的真实载荷零校验错误', async () => {
    expect(await validateLikePipe(SysDeviceDTOInitialRequest, VALID_BODY)).toHaveLength(0)
  })

  it('仍携带 deviceName ⇒ whitelistValidation（线上即 40099）', async () => {
    const errors = await validateLikePipe(SysDeviceDTOInitialRequest, {
      ...VALID_BODY,
      deviceName: 'client-side-name',
    })

    const hit = errors.find(error => error.property === 'deviceName')
    expect(hit).toBeDefined()
    expect(hit!.constraints).toHaveProperty('whitelistValidation')
  })
})
