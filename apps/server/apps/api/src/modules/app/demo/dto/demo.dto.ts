import { RealOmitType, RealPartialType, RealPickType } from '@walnut/utils/dto'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { AppDemoModel } from '../schema/demo.schema'

export class AppDemoDTO extends AppDemoModel {
  constructor(partial: Partial<AppDemoDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class AppDemoDTOSafe extends RealOmitType(AppDemoDTO, [] as const) {
  constructor(partial: Partial<AppDemoDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// list
export class AppDemoDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(AppDemoDTOSafe),
) {}

export class AppDemoDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(AppDemoDTOSafe),
) {}

// create
export class AppDemoDTOCreateRequest extends RealPickType(AppDemoDTOSafe, [
  'demoString',
  'demoPhoneNumber',
  'demoNumber',
  'demoBoolean',
  'demoDate',
  'demoEnum',
  'demoMongoId',
  'demoObject',
] as const) {}
export class AppDemoDTOCreateResponse extends AppDemoDTOSafe {}

// read
export class AppDemoDTOReadResponse extends AppDemoDTOSafe {}

// update
export class AppDemoDTOUpdateRequest extends RealPickType(AppDemoDTOSafe, [
  'demoString',
  'demoPhoneNumber',
  'demoNumber',
  'demoBoolean',
  'demoDate',
  'demoEnum',
  'demoMongoId',
  'demoObject',
] as const) {}
export class AppDemoDTOUpdateResponse extends AppDemoDTOSafe {}

// delete
export class AppDemoDTODeleteResponse extends AppDemoDTOSafe {}
