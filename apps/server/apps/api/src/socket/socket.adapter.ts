import type { INestApplicationContext } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { Server, ServerOptions } from 'socket.io'
import { IoAdapter } from '@nestjs/platform-socket.io'

export class SocketIoAdapter extends IoAdapter {
  constructor(
    private readonly app: INestApplicationContext,
    private readonly configService: ConfigService,
  ) {
    super(app)
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    port = this.configService.get<number>('socket.port')!
    const path = this.configService.get<string>('socket.path')!
    const origins = this.configService.get<string>(
      'socket.origin',
    )!
    const origin = origins.split(',')
    // Nest 12 的 IoAdapter.createIOServer 第二参为可选，这里合并而非就地改写
    return super.createIOServer(port, {
      // Super 的 ServerOptions 全部字段必填；Nest 12 允许调用方省略整个 options，
      // 运行时展开 undefined 等价于空对象，这里按完整类型断言收口
      ...(options as ServerOptions),
      path,
      cors: { origin },
    })
  }
}
