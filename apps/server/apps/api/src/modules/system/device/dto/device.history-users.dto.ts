import { IntersectionType } from '@nestjs/swagger'
import { SharedTimeDTO } from '@walnut-server/list'
import { RealPickType } from '@walnut-server/utils/dto'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'

/**
 * 设备历史用户出参（batch 5 从 device.dto 拆出，批 7 留 app）。
 *
 * 为什么不在 libs/system：它按 `SysUserDTOSafe` 投影 —— user 的 wire DTO 因 swagger
 * schema 注册顺序留在 app（批 6 的裁定，见 `modules/system/user/dto/user.dto.ts`）。
 * lib 的 device.dto 只保留不依赖 app wire DTO 的部分。
 */
export class SysDeviceDTOHistoryUsersResponse extends IntersectionType(
  RealPickType(SysUserDTOSafe, ['id', 'nickName', 'userName'] as const),
  RealPickType(SharedTimeDTO, ['lastActiveAt'] as const),
) {
  constructor(partial?: Partial<SysDeviceDTOHistoryUsersResponse>) {
    super()
    Object.assign(this, partial)
  }
}
