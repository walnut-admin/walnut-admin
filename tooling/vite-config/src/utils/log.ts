import chalk from 'chalk'

import { getNow } from 'easy-fns-ts'

/**
 * 日志前缀里的包名。默认是本包名，调用方通过 `configureBuildLogger` 换成自己的名字
 * （`createVitePlugins` 会做这一步；独立脚本要自己的前缀就自己调一次）。
 *
 * 为什么是模块级配置而不是每个函数多一个参数：调用点分散在插件深处（iconify 的 `IconLog`、
 * `fs` 的读写工具），逐个传包名只会给每个纯工具函数加一个与它职责无关的参数。
 */
let logPackageName = '@walnut/vite-config'

export function configureBuildLogger(packageName: string) {
  logPackageName = packageName
}

function title(stage: string) {
  return chalk.magenta.bgBlack(`[${logPackageName.toUpperCase()}] - [${getNow()}] - [${stage}]`)
}

export function BuildUtilsLog(msg: string, stage = 'Log') {
  console.log(`${title(stage)}: ${msg}`)
}
