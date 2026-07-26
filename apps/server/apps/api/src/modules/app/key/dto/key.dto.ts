import { RealOmitType, RealPickType } from '@walnut-server/utils/dto'
import { AppKeyModel } from '../schema/key.schema'

export class AppKeyDTO extends AppKeyModel {
  constructor(partial?: Partial<AppKeyDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class AppKeyDTOSafe extends RealOmitType(AppKeyDTO, [] as const) {
  constructor(partial?: Partial<AppKeyDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

export class AppKeyDTOInit extends RealPickType(AppKeyDTOSafe, ['type'] as const) {
  constructor(partial: Partial<AppKeyDTOInit>) {
    super()
    Object.assign(this, partial)
  }
}
