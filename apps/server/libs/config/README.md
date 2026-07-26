# @walnut/config

Global NestJS configuration module wrapping `@nestjs/config`. Loads environment-specific `.env` files from `env/` (production) or `env-local/` (development), validates all required environment variables at startup using `class-validator`, and registers 9 typed config namespaces accessible via `ConfigService`.

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `WalnutConfigModule` | NestJS `@Global()` Module | The single import — configures `ConfigModule.forRoot()` globally |

Additionally, the sub-path `@walnut/config/utils/env` exports:

| Export | Type | Description |
|--------|------|-------------|
| `isDev` | `boolean` | True when `NODE_ENV` is not `production` or `stage` |
| `isProd` | `boolean` | True when `NODE_ENV` is `production` |
| `isStage` | `boolean` | True when `NODE_ENV` is `stage` |

## Key Files

| File | Purpose |
|------|---------|
| `src/config.module.ts` | Module definition — determines env file path (`env-local/` for dev, `env/` for prod), loads 9 config namespaces, registers global validation |
| `src/validation.ts` | `EnvironmentVariables` class with ~55 `@IsString`/`@IsNumber` fields validating all required env vars; `validateConfig()` function using `plainToClass` + `validateSync` |
| `src/utils/env.ts` | Exports `isDev`, `isProd`, `isStage` booleans derived from `process.env.NODE_ENV` |

### Config Namespaces (`src/modules/`)

| File | Namespace | Key Config Fields |
|------|-----------|-------------------|
| `app.config.ts` | `app` | app name, port, API prefix/version, throttle TTL/limit, cache TTL/max, Redis host/port/pass, cookie/session secrets, i18n fallback |
| `database.config.ts` | `database` | MongoDB primary/secondary/arbiter hosts, replica set name, db name, auth source, user/pass |
| `jwt.config.ts` | `jwt` | Access/refresh token secrets and expiry, opaque secret |
| `auth.config.ts` | `auth` | GitHub/Gitee/Google OAuth client IDs/secrets/callbacks, WebAuthn RPID/origin |
| `crypto.config.ts` | `crypto` | MFA encryption key, refresh-token encryption key, device-ID encryption key, user-identity encryption key and hash salt |
| `email.config.ts` | `email` | SMTP host, port, auth user/pass, from address/name |
| `socket.config.ts` | `socket` | Socket.IO server port, path, origin |
| `vendor.config.ts` | `vendor` | Baidu AK, Aliyun OSS (region/bucket/credentials/ARN/role), Tencent SMS (region/credentials/appId/sign/template) |
| `middleware.config.ts` | `middleware` | CORS allow-methods, allow-origin (production domain or `*`), allow-headers list |

## Usage

```typescript
// 1. Import in root AppModule
import { WalnutConfigModule } from '@walnut/config'

@Module({
  imports: [WalnutConfigModule],
})
export class AppModule {}

// 2. Inject ConfigService anywhere (module is @Global)
import { ConfigService } from '@nestjs/config'

@Injectable()
export class MyService {
  constructor(private readonly configService: ConfigService) {}

  getSecret() {
    return this.configService.get<string>('jwt.accessTokenSecret')
  }
}

// 3. Use environment helpers (from sub-path)
import { isDev, isProd } from '@walnut/config/utils/env'

if (isDev) {
  console.log('Running in development mode')
}
```

## Dependencies

- **Internal**: None (but exports `isDev`/`isProd` used by `@walnut/utils`, `@walnut/exceptions`, and many app modules)
- **External**: `@nestjs/config`, `class-validator`, `class-transformer`

## Notes

- Environment files are loaded from `env/` in production and `env-local/` in development
- Startup validation fails fast if any required env var is missing — the app will not boot
- The `isDev`/`isProd`/`isStage` helpers from `@walnut/config/utils/env` are a cross-cutting concern used by many other libs and app modules
- **Critical env vars** that should never change after deployment (would break existing encrypted data): `AUTH_OPAQUE_SECRET`, `MFA_ENCRYPTION_KEY`, `RT_ENCRYPTION_KEY`, `DEVICE_ID_ENCRYPTION_KEY`, `USER_ID_ENCRYPTION_KEY`, `USER_ID_HASH_SALT`
