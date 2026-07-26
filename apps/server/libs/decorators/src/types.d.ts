import type { ClassConstructor } from 'class-transformer'

declare global {
  interface IWalnutAdminApiOkResponseOptions {
    DTO?: ClassConstructor<any> | null
    description?: string
    isArray?: boolean
    primitive?: 'string' | 'number' | 'boolean'
  }
}

export {}
