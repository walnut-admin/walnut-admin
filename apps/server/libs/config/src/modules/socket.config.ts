import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('socket', () => ({
  port: Number.parseInt(process.env.SOCKET_SERVER_PORT),
  path: process.env.SOCKET_SERVER_PATH,
  origin: process.env.SOCKET_SERVER_ORIGIN,
}))
