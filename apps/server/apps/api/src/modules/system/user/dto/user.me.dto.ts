import { IntersectionType } from '@nestjs/swagger'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { SysUserDTOSafe } from './user.dto'

export class SysUserMeDTOUpdateProfileRequest extends IntersectionType(
  RealPickType(SysUserDTOSafe, [
    'userName',
    'nickName',
  ] as const),
  RealPartialType(RealPickType(SysUserDTOSafe, [
    'avatar',
    'description',
    'gender',
  ] as const)),
) {}
