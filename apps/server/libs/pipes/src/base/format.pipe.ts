import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { isNil } from 'lodash'

/**
 * 业务键 string 的入口格式约束管道族 —— 裸 param/query 收进白名单形态
 * （缩小注入面：路径 `..%2F` payload、缓存键任意串、超长串都拦在管道层，
 * 统一抛 WalnutAdminExceptionRequestDataError（40099），与 ParamEnum 同族）。
 *
 * 每个管道绑定一条从真实数据形态推出来的正则（写明出处），改形态先改正则。
 */

@Injectable()
export class WalnutAdminPipePattern implements PipeTransform<unknown, string> {
  constructor(
    private readonly pattern: RegExp,
    private readonly expected: string,
    private readonly options: { required: boolean } = { required: true },
  ) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    const { required } = this.options

    if (isNil(value)) {
      if (!required) {
        return undefined as unknown as string
      }
      throw new WalnutAdminExceptionRequestDataError(
        `type: ${metadata.type}; field: ${metadata.data}; error: required`,
      )
    }

    if (typeof value !== 'string' || !this.pattern.test(value)) {
      throw new WalnutAdminExceptionRequestDataError(
        `type: ${metadata.type}; field: ${metadata.data}; expected: ${this.expected}`,
      )
    }

    return value
  }
}

/** sys_device.device_id = HMAC-SHA256(fingerprint) hex（device.repo.service getDeviceIdByFingerprint）→ 固定 64 位 hex */
const DEVICE_ID_PATTERN = /^[0-9a-f]{64}$/i

@Injectable()
export class WalnutAdminPipeDeviceId extends WalnutAdminPipePattern {
  constructor() {
    super(DEVICE_ID_PATTERN, '64-char hex string (HMAC-SHA256 of device fingerprint)')
  }
}

/** shared_area.pcode = 行政区划码 varchar(12)（InitSchema）或顶层 '0'（area.service 缺省根）→ 纯数字 ≤12 位 */
const AREA_PCODE_PATTERN = /^\d{1,12}$/

@Injectable()
export class WalnutAdminPipeAreaPcode extends WalnutAdminPipePattern {
  constructor() {
    super(AREA_PCODE_PATTERN, '1-12 digit area code (varchar(12)) or "0" for top level')
  }
}

/** 缓存键显示形态（不含 WALNUT_CACHE_ 前缀）：`SECURITY:CAP_TOKEN:<64hex>`、`AUTH:MFA:VERIFIED:<uuid>:<64hex>` 等 → 大小写字母数字 + :_.-，≤128 */
const CACHE_KEY_PATTERN = /^[A-Z0-9][\w:.-]{0,127}$/i

@Injectable()
export class WalnutAdminPipeCacheKey extends WalnutAdminPipePattern {
  constructor() {
    super(CACHE_KEY_PATTERN, 'cache key without WALNUT_CACHE_ prefix (letters/digits/:/ _/./-)')
  }
}

/** 日志文件名：list 端点真实形态 `2026-10-25-15.log(.gz)`，测试通道自建 `api-spec-<seed>.log` → 首字符字母数字，禁路径分隔符，.log/.log.gz 结尾 */
const LOG_FILE_NAME_PATTERN = /^[A-Za-z0-9][\w.-]*\.log(\.gz)?$/

@Injectable()
export class WalnutAdminPipeLogFileName extends WalnutAdminPipePattern {
  constructor() {
    super(LOG_FILE_NAME_PATTERN, 'log file name like 2026-10-25-15.log(.gz)')
  }
}
