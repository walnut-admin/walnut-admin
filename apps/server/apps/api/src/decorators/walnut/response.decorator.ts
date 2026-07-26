import { SetMetadata } from '@nestjs/common'

import { WalnutAdminConstDecoratorFreeResponseMetadataKey } from '@walnut/const/decorator/response'

export function WalnutAdminDecoratorFreeResponse() {
  return SetMetadata(WalnutAdminConstDecoratorFreeResponseMetadataKey.FREE_RESPONSE, true)
}
