import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common'
import { isValidDeviceId, WALNUT_DEVICE_ID_PREFIX } from '@walnut-server/const/app/device'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'
import { isNil } from 'lodash'

/**
 * 业务键 string 的入口格式约束管道族 —— 裸 param/query 收进白名单形态
 * （缩小注入面：路径 `..%2F` payload、缓存键任意串、超长串都拦在管道层，
 * 统一抛 WalnutAdminExceptionRequestDataError（40099），与 ParamEnum 同族）。
 *
 * 每个管道绑定一条从真实数据形态推出来的正则（写明出处），改形态先改正则。
 * 形态的判据若已有单一真源（如设备 id 的 isValidDeviceId），传**谓词**而不是再抄
 * 一份正则 —— RegExp 自带同签名的 test，两种形态都满足这里声明的接口。
 */

/** 值判据：正则与谓词式校验（如 isValidDeviceId）都实现同签名 */
export interface IWalnutAdminPipeValueMatcher {
  test: (value: string) => boolean
}

@Injectable()
export class WalnutAdminPipePattern implements PipeTransform<unknown, string> {
  constructor(
    private readonly matcher: IWalnutAdminPipeValueMatcher,
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

    if (typeof value !== 'string' || !this.matcher.test(value)) {
      throw new WalnutAdminExceptionRequestDataError(
        `type: ${metadata.type}; field: ${metadata.data}; expected: ${this.expected}`,
      )
    }

    return value
  }
}

/**
 * sys_device.device_id —— **服务端签发**的 d1_ + 32 位小写 hex（B5）。
 *
 * 判据的唯一真源是 @walnut-server/const/app/device 的 isValidDeviceId（与 DeviceGuard、
 * device/initial 的签发腿、migration 的 CHECK 同一形态）：这里只做转发，不再抄正则。
 * 改造前这里按 64 位 hex 校验 —— 而 device_id 早已是随机 d1_ 值，于是四个 :deviceId
 * 路由（改名 / 锁 / 解锁 / 强制下线）对真实设备**恒 40099**。
 */
@Injectable()
export class WalnutAdminPipeDeviceId extends WalnutAdminPipePattern {
  constructor() {
    super({ test: isValidDeviceId }, `${WALNUT_DEVICE_ID_PREFIX}<32 lowercase hex> (server-issued device id)`)
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
