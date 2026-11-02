import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field'

/**
 * `GET /deps` 响应 —— server `package.json` 的 dependencies / devDependencies 清单
 * （name -> version range）。`Record<string, string>` 在 swagger 里以
 * `additionalProperties: { type: 'string' }` 声明，生成类型才是可用的索引签名。
 */
export class AppBackendDepsResponseDTO {
  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      title: 'package.json dependencies',
      description: 'dependency name -> version range',
      additionalProperties: { type: 'string' },
    },
  })
  dependencies: Record<string, string>

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      title: 'package.json devDependencies',
      description: 'dev dependency name -> version range',
      additionalProperties: { type: 'string' },
    },
  })
  devDependencies: Record<string, string>
}
