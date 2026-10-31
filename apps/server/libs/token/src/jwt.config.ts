import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtModuleOptions, JwtOptionsFactory } from '@nestjs/jwt'

@Injectable()
export class JwtConfigClass implements JwtOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createJwtOptions(): JwtModuleOptions {
    return {
      secret: this.configService.get<string>('jwt.access.secret'),
      signOptions: {
        expiresIn: `${this.configService.get<number>('jwt.access.expire')!}s`,
      },
    }
  }
}
