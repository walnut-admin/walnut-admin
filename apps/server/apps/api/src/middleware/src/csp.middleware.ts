import type { NextFunction } from 'express'
import { Injectable, NestMiddleware } from '@nestjs/common'
import { expressCspHeader, NONE, SELF } from 'express-csp-header'

@Injectable()
export class CSPMiddleware implements NestMiddleware {
  constructor() {}

  use(
    req: IWalnutAdminExpressRequest,
    res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    expressCspHeader({
      directives: {
        // Default source, only allow loading resources from the current origin
        'default-src': [SELF],
        // Script source, only allow loading scripts from the current origin, inline scripts are not allowed
        'script-src': [SELF],
        // Style source, only allow loading styles from the current origin, inline styles are not allowed
        'style-src': [SELF],
        // Image source, allow loading images from the current origin and data: protocol
        'img-src': [SELF, 'data:'],
        // Font source, only allow loading fonts from the current origin
        'font-src': [SELF],
        // Media source, only allow loading media files from the current origin
        'media-src': [SELF],
        // Do not allow using web workers
        'worker-src': [NONE],
        // Do not allow using object tags to load resources
        'object-src': [NONE],
        // Block all mixed content (HTTP and HTTPS mixed)
        'block-all-mixed-content': true,
      },
    })(req, res, next)
  }
}
