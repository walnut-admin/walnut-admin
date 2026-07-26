import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('auth', () => ({
  github: {
    clientId: process.env.AUTH_GITHUB_CLIENTID,
    clientSecret: process.env.AUTH_GITHUB_CLIENTSECRET,
    callbackURL: process.env.AUTH_GITHUB_CALLBACK,
  },
  gitee: {
    clientId: process.env.AUTH_GITEE_CLIENTID,
    clientSecret: process.env.AUTH_GITEE_CLIENTSECRET,
    callbackURL: process.env.AUTH_GITEE_CALLBACK,
  },
  google: {
    clientId: process.env.AUTH_GOOGLE_CLIENTID,
  },
  mfa: {
    webauthn: {
      rpId: process.env.AUTH_WEBAUTHN_RPID,
      origin: process.env.AUTH_WEBAUTHN_ORIGIN,
    },
  },
}))
