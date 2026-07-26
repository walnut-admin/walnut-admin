import * as process from 'node:process'

export const isDev = process.env.NODE_ENV === 'development'
export const isProd = process.env.NODE_ENV === 'production'
export const isStage = process.env.NODE_ENV === 'stage'

export const WalnutAdminEnv = process.env.NODE_ENV
