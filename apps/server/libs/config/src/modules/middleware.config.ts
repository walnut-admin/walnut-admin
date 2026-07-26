import type { Recordable } from 'easy-fns-ts'
import { registerAs } from '@nestjs/config'
import { isProd } from '@walnut-server/config/utils/env'
import { WalnutAdminConstAppHeaders } from '@walnut-server/const/app/header'
import { WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { getPackageJsonData } from '@walnut-server/utils/pkg'

const pkg = getPackageJsonData()

export default registerAs('middleware', () => ({
  cors: {
    allowMethod: [
      WalnutAdminConstAppHTTPMethods.GET,
      WalnutAdminConstAppHTTPMethods.POST,
      WalnutAdminConstAppHTTPMethods.DELETE,
      WalnutAdminConstAppHTTPMethods.PUT,
      WalnutAdminConstAppHTTPMethods.PATCH,
    ],

    allowOrigin: isProd ? `https://www.${(pkg.config as Recordable).domain as string}` : '*',

    allowHeader: [
      'Accept',
      'Accept-Language',
      'Content-Language',
      'Content-Type',
      'Origin',
      'Authorization',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Credentials',
      'Access-Control-Expose-Headers',
      'Access-Control-Max-Age',
      'Referer',
      'Host',
      'X-Requested-With',
      'X-Content-Type-Options',
      ...Object.values(WalnutAdminConstAppHeaders),
    ],
  },
}))
