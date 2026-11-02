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
      // F-42：**验签**算法白名单。@nestjs/jwt 会把 verifyOptions 合并进每一次
      // verify / verifyAsync（jwt.service.js 的 mergeJwtOptions），所以
      // AppTokenService.verifyAccessToken 这类只传 { secret, ignoreExpiration } 的
      // 调用点也自动受约束。
      //
      // 为什么必须显式钉：这把 secret 是**对称**密钥，jsonwebtoken 在未指定 algorithms
      // 时会按 token header 里的 alg 选算法 —— 攻击者可以把 alg 换成同族但更弱的算法
      // 再重算签名（对称密钥场景下没有公钥混淆面，但算法降级 / alg 失控本身就是已知
      // 的攻击面）。钉死 HS256 后只有与签发端一致的算法能通过验签。
      //
      // 只加 verifyOptions，**不动 signOptions.algorithm**：签发端保持默认（HS256），
      // token 生成逻辑一个字都没改。
      verifyOptions: {
        algorithms: ['HS256'],
      },
    }
  }
}
