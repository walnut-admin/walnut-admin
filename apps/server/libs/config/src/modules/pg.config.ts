import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('pg', () => ({
  host: process.env.DATABASE_PG_HOST,
  port: Number.parseInt(process.env.DATABASE_PG_PORT),
  user: process.env.DATABASE_PG_USER,
  pass: process.env.DATABASE_PG_PASS,
  name: process.env.DATABASE_PG_NAME,
}))
