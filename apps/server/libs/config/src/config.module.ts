import { join } from 'node:path'
import * as process from 'node:process'
import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import AppConfig from './modules/app.config'
import AuthConfig from './modules/auth.config'
import CryptoConfig from './modules/crypto.config'
import DBConfig from './modules/database.config'
import EmailConfig from './modules/email.config'
import JwtConfig from './modules/jwt.config'
import MiddlewareConfig from './modules/middleware.config'
import SocketConfig from './modules/socket.config'
import VendorConfig from './modules/vendor.config'
import { validateConfig } from './validation'

const rawEnv = process.env.NODE_ENV
const env = rawEnv ?? 'development'
const projectRoot = process.cwd()
const envFilePath = join(projectRoot, 'env-local', `.env.${env}`)

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath,
      load: [
        DBConfig,
        JwtConfig,
        AppConfig,
        VendorConfig,
        CryptoConfig,
        EmailConfig,
        AuthConfig,
        SocketConfig,
        MiddlewareConfig,
      ],
      isGlobal: true,
      validate: validateConfig,
    }),
  ],
})
export class WalnutConfigModule {}
