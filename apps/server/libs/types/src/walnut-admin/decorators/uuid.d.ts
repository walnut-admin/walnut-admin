import type { ClassConstructor } from 'class-transformer'

declare global {
  interface IWalnutAdminDecoratorValidatorUuidOptions {
    validate?: ClassConstructor<any>
    nullable?: boolean
  }

  type IWADVUuidOpt = IWalnutAdminDecoratorValidatorUuidOptions
}

export {}
