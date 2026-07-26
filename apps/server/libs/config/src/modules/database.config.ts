import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('database', () => ({
  primary: process.env.DATABASE_PRIMARY,
  secondary: process.env.DATABASE_SECONDARY,
  arbiter: process.env.DATABASE_ARBITER,
  replicaset: process.env.DATABASE_REPLICASET,

  name: process.env.DATABASE_NAME,
  source: process.env.DATABASE_SOURCE,
  user: process.env.DATABASE_USER,
  pass: process.env.DATABASE_PASS,
}))
