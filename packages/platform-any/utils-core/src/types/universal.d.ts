export type Fn<T = any, R = T> = (...arg: T[]) => R

export type PromiseFn<T = any> = (args?: T) => Promise<void>

export type IActionType = 'create' | 'update' | 'detail'
