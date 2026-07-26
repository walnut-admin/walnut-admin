import { RealOmitType } from '@walnut-server/utils/dto'
import { AppErrorModel } from './error.schema'

class AppErrorDTO extends AppErrorModel {
  constructor(partial: Partial<AppErrorDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class AppErrorDTOSafe extends RealOmitType(AppErrorDTO, [] as const) {
  constructor(partial: Partial<AppErrorDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}
