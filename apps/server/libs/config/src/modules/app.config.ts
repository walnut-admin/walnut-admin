import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('app', () => ({
  name: process.env.APP_NAME,
  serverName: process.env.SERVER_NAME,

  port: Number.parseInt(process.env.APP_PORT),

  api: {
    prefix: process.env.APP_API_PREFIX,
    version: Number.parseInt(process.env.APP_API_VERSION),
  },

  throttle: {
    ttl: Number.parseInt(process.env.APP_THROTTLE_TTL),
    limit: Number.parseInt(process.env.APP_THROTTLE_LIMIT),
  },

  i18n: {
    fallback: process.env.APP_I18N_FALLBACK,
  },

  cache: {
    ttl: Number.parseInt(process.env.APP_CACHE_TTL),
    max: Number.parseInt(process.env.APP_CACHE_MAX),
  },

  redis: {
    host: process.env.APP_REDIS_HOST,
    port: Number.parseInt(process.env.APP_REDIS_PORT),
    pass: process.env.APP_REDIS_PASS,
  },

  cookie: {
    secret: process.env.APP_COOKIE_SECRET,
  },
  session: {
    secret: process.env.APP_SESSION_SECRET,
  },
}))
