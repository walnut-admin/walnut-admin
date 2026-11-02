import type { ClassConstructor } from 'class-transformer'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AppLoggerDTO, AppLoggerDTOListRequest, AppSettingDTOListRequest } from '@walnut-server/app-domain'
import { SysUserIdentityBindRequestDTO, SysUserIdentityListDTO, WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import { SecuritySensitiveCheckResponseDTO, WalnutAdminConstVerifyMethod } from '@walnut-server/security'
import {
  SysDictDataDTOListRequest,
  SysLocaleDTOCreateRequest,
  SysLocaleDTOListRequest,
  SysLocaleDTOSafe,
  SysLogAuthDTOListRequest,
  SysLogOperateDTOListRequest,
  SysPostDTOListRequest,
} from '@walnut-server/system'
import { plainToInstance } from 'class-transformer'
import { getMetadataStorage, validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { AppMonitorUserDTOListRequest, AppMonitorUserDTOReadResponse } from '@/modules/app/monitor/user/dto/user.dto'
import { SysDeletedDTORecoverRequest, SystemDeletedDTOListRequest } from '@/modules/system/deleted/dto/deleted.dto'

/**
 * F-38（Q6=b）回归：DTO 硬规矩清理 —— 字段声明不带 `?` / `!`，可选性只由字段装饰器表达。
 *
 * 两件事分开钉：
 * ① 机械面：本次清理过的 DTO 文件里不许再出现「字段?:」/「字段!:」，防回潮；
 * ② 行为面（wire 兼容）：去掉类型标记后，**校验结果与默认值必须与清理前一致** ——
 *    list 请求的空查询仍然零错误、bind 的 setAsSecurity 缺省仍落到 false。
 *
 * 唯一有意收紧的一条：`SysDeletedDTORecoverRequest.id`（基座不再挂 IsOptional，
 * PickType 也不再继承「可选」）—— 它与该 DTO 早已发布的 swagger（`required: true`）
 * 和类注释口径一致，缺 id 的恢复请求本来也走不到成功路径。见本文件最后一条用例。
 */

// 本次清理过的 DTO 文件（16 个 id 模板 + user_device / user_identity / key / log.*）。
// 豁免：libs/identity/src/user_mfa/webauthn/webauthn.dto.ts 的 `?` 是对
// @simplewebauthn/server 选项形状的镜像（该文件里有 F-38 豁免说明，且不挂任何校验装饰器），
// 不在清理面内。
//
// 批 6-A（5B 的同类残留收尾）追加 6 个文件：DTO 公共基座
// （libs/identity/src/shared/base.model.ts 的 createdAt/updatedAt）、wire / lib 两侧的
// monitor user、logger、security sensitive、list 的 device-geo —— 它们此后同样受
// 「字段不写 ?/!」这条机械断言保护。
const CLEANED_DTO_FILES = [
  'apps/api/src/modules/system/user/dto/user.dto.ts',
  'apps/api/src/modules/system/deleted/dto/deleted.dto.ts',
  'libs/app-domain/src/demo/dto/demo.dto.ts',
  'libs/app-domain/src/key/dto/key.dto.ts',
  'libs/app-domain/src/setting/dto/setting.dto.ts',
  'libs/identity/src/user_device/dto/user_device.dto.ts',
  'libs/identity/src/user_identity/dto/user_identity.dto.ts',
  'libs/system/src/dept/dto/dept.dto.ts',
  'libs/system/src/dict/dictData/dto/dictData.dto.ts',
  'libs/system/src/dict/dictType/dto/dictType.dto.ts',
  'libs/system/src/employee/dto/employee.dto.ts',
  'libs/system/src/lang/dto/lang.dto.ts',
  'libs/system/src/locale/dto/locale.dto.ts',
  'libs/system/src/logs/auth/dto/log.auth.dto.ts',
  'libs/system/src/logs/operate/dto/log.operate.dto.ts',
  'libs/system/src/menu/dto/menu.dto.ts',
  'libs/system/src/post/dto/post.dto.ts',
  'libs/system/src/role/dto/role.dto.ts',
  // —— 批 6-A ——
  'libs/identity/src/shared/base.model.ts',
  'libs/app-domain/src/monitor/user/dto/user.dto.ts',
  'libs/app-domain/src/logger/dto/logger.dto.ts',
  'libs/security/src/sensitive/sensitive.dto.ts',
  'libs/list/src/device-geo.dto.ts',
  'apps/api/src/modules/app/monitor/user/dto/user.dto.ts',
] as const

/** 源码里的字段可选标记 / 明确赋值断言（行首缩进后的 `name?:` 或 `name!:`） */
const FORBIDDEN_MARK = /^\s{2,}(?:readonly\s+)?[A-Za-z_$][\w$]*(?:\?:|!\s*:)/gm

describe('dto 字段形状（F-38：`?` / `!` 禁止，可选性归装饰器）', () => {
  it('清理过的 DTO 文件里不再出现「字段?:」与「字段!:」', () => {
    const violations: string[] = []

    for (const file of CLEANED_DTO_FILES) {
      const absolute = resolve(process.cwd(), file)
      expect(existsSync(absolute), `清理清单里的文件不存在：${file}`).toBe(true)

      const source = readFileSync(absolute, 'utf8')
      for (const match of source.matchAll(FORBIDDEN_MARK)) {
        violations.push(`${file}: ${match[0].trim()}`)
      }
    }

    expect(violations, '字段声明又带上了 ?/! 标记：可选性只由字段装饰器声明').toEqual([])
  })

  it('list 请求：空查询仍然零校验错误（去掉 IsOptional 后行为不变）', () => {
    // 并集直接交给 plainToInstance 会退化到第一个构造签名，显式标注成同一族
    const cases: ClassConstructor<object>[] = [
      SysPostDTOListRequest,
      SysLocaleDTOListRequest,
      SysDictDataDTOListRequest,
      SysLogAuthDTOListRequest,
      SysLogOperateDTOListRequest,
      SystemDeletedDTOListRequest,
      AppSettingDTOListRequest,
      // 批 6-A 清理的两个 list 请求（id / ip / 5 个 logger 键去掉 IsOptional 后
      // 入参校验必须仍然放行空查询）
      AppMonitorUserDTOListRequest,
      AppLoggerDTOListRequest,
    ]

    for (const dto of cases) {
      // 完全空体 / 只给空 query：query 信封不挂 ValidateNested（list.dto.ts 的
      // required: false → Allow），两层都必须是零错误
      expect(validateSync(plainToInstance(dto, {})), `${dto.name} 空体`).toEqual([])
      expect(validateSync(plainToInstance(dto, { query: {} })), `${dto.name} 空 query`).toEqual([])
    }
  })

  it('响应面 `id` 仍是 @Expose 键（主键仍随响应下发，RealPickType 仍能枚举到它）', () => {
    expect(Object.keys(plainToInstance(SysLocaleDTOSafe, {}))).toContain('id')
  })

  it('bind：缺 setAsSecurity 时校验放行，且装饰器声明的 default 被真正物化成 false', () => {
    const dto = plainToInstance(SysUserIdentityBindRequestDTO, {
      identifier: 'demo@walnut.dev',
      verifyCode: '123456',
    })

    expect(validateSync(dto)).toEqual([])
    expect(dto.setAsSecurity).toBe(false)

    // 显式 true / 'true' 不被默认值盖掉（booleanString transform 先跑，default 只补 nil）
    expect(plainToInstance(SysUserIdentityBindRequestDTO, {
      identifier: 'demo@walnut.dev',
      verifyCode: '123456',
      setAsSecurity: 'true',
    }).setAsSecurity).toBe(true)
  })

  it('list 标记 DTO：空类仍能通过 forbidUnknownValues（@Allow 换项目校验器后等价）', () => {
    expect(validateSync(plainToInstance(SysUserIdentityListDTO, {}))).toEqual([])
    // 有校验元数据才不会被判成 "an unknown value was passed to the validate function"
    expect(getMetadataStorage().getTargetValidationMetadatas(SysUserIdentityListDTO, '', false, false).length)
      .toBeGreaterThan(0)
  })

  it('批 6-A：基座 createdAt/updatedAt 变成真必填（IsOptional 摘除），@Expose 键仍在', () => {
    // 响应序列化面：两个键仍是 @Expose 键（ClassSerializerInterceptor 的
    // excludeExtraneousValues 只放行 Expose 字段，掉了就等于响应里凭空消失）
    expect(Object.keys(plainToInstance(WalnutAdminCommonBasicModel, {})))
      .toEqual(expect.arrayContaining(['createdAt', 'updatedAt']))

    // 校验面：缺值现在会报错 —— 证明 IsOptional 是真摘掉了，而不是只删了类型上的 `?`
    expect(validateSync(plainToInstance(WalnutAdminCommonBasicModel, {})).map(error => error.property).sort())
      .toEqual(['createdAt', 'updatedAt'])
  })

  it('批 6-A：写路径不受影响（create 请求不要时间列，RealPartialType 仍放过空体）', () => {
    // 基座必填化只影响「继承到了这两个键」的形态；create/update 由 RealPickType /
    // RealPartialType 收窄白名单，时间列本来就不在入参里 —— 这里钉住不回潮
    const createProps = validateSync(plainToInstance(SysLocaleDTOCreateRequest, {})).map(error => error.property)
    expect(createProps).not.toContain('createdAt')
    expect(createProps).not.toContain('updatedAt')
  })

  it('批 6-A：monitor user 读响应的 id 是真必填，list 查询仍可省', () => {
    expect(Object.keys(plainToInstance(AppMonitorUserDTOReadResponse, {}))).toContain('id')
    // 响应面不再自带 IsOptional → 缺 id 会被校验报出来（此前是静默放行）
    expect(validateSync(plainToInstance(AppMonitorUserDTOReadResponse, {})).map(error => error.property))
      .toContain('id')
  })

  it('批 6-A：logger 行的 5 个键仍是 @Expose 键（相对 fileSize 的 TransformSizeToKB 未动）', () => {
    expect(Object.keys(plainToInstance(AppLoggerDTO, {})))
      .toEqual(expect.arrayContaining(['fileName', 'filePath', 'fileSize', 'fileMTime', 'logType']))
  })

  it('批 6-A：sensitive check 的分支字段仍按「键缺席」出现（default: null 只在 swagger 面）', () => {
    const authorized = new SecuritySensitiveCheckResponseDTO({ needsVerification: false, remainingSeconds: 42 })
    expect(authorized.availableMethods).toBeUndefined()
    expect(authorized.preferredMethod).toBeUndefined()

    const challenge = new SecuritySensitiveCheckResponseDTO({
      needsVerification: true,
      availableMethods: [WalnutAdminConstVerifyMethod.EMAIL],
      preferredMethod: WalnutAdminConstVerifyMethod.EMAIL,
    })
    expect(challenge.remainingSeconds).toBeUndefined()
  })

  it('recover：id 现在是真必填（与已发布 swagger 的 required: true 对齐）', () => {
    const deletedId = '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'

    expect(validateSync(plainToInstance(SysDeletedDTORecoverRequest, { deletedId })).map(error => error.property))
      .toEqual(['id'])
    expect(validateSync(plainToInstance(SysDeletedDTORecoverRequest, { id: deletedId, deletedId })))
      .toEqual([])
  })
})
