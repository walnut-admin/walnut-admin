import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('jwt', () => ({
  access: {
    secret: process.env.JWT_ACCESS_TOKEN_SECRET,
    expire: Number.parseInt(process.env.JWT_ACCESS_TOKEN_EXPIRE),
  },
  refresh: {
    secret: process.env.JWT_REFRESH_TOKEN_SECRET,
    expire: Number.parseInt(process.env.JWT_REFRESH_TOKEN_EXPIRE),
  },
  opaque: {
    secret: process.env.AUTH_OPAQUE_SECRET,
  },
}))
