#!/usr/bin/env node
/**
 * `pnpm walnut` 的入口：仓库级命令的统一门面（命令表在 `src/lib/commands.ts`）。
 *
 * 用法：
 *   pnpm walnut [选项] <命令 id> [<命令 id>…]   按表里的顺序执行选中的命令
 *   pnpm walnut --list                    每行一条「id、分组、说明」
 *   pnpm walnut --json                    整张表的机器可读形态
 *   pnpm walnut --dry-run <id>            只打印将要执行的命令行
 *   pnpm walnut --help                    打印用法
 *
 * 入口自己的选项只认**第一个命令 id 之前**的；id 之后的旗标属于那条命令
 * （`pnpm walnut db:seed:pg --dry-run` 里的 `--dry-run` 是 db:seed:pg 的，不是入口的）。
 * `--` 之后的参数一律透传；带参数时只允许选中一条命令；非旗标的词只有表里声明了
 * `positionalArgs` 的命令才当位置参数。细则见 `src/run/args.ts` 的头注释。
 *
 * ## 为什么本文件**不登记为 bin**，而由根脚本直接 `node` 调用
 *
 * 本文件在 `bin/` 下，但它刻意不在 `package.json` 的 `bin` 字段里：根脚本是
 * `"walnut": "node tooling/scripts/bin/run.ts"`。两条理由，缺一条都站不住：
 *
 * 1. **入口必须能在没有 `node_modules` 的仓库里运行**。命令表里有一条 `clean:all`，它的职责就是删掉
 *    根 `node_modules`；如果入口自己经 `node_modules/.bin` 的垫片启动，就等于让它拆自己脚下的地板 ——
 *    Windows 上 cmd 是逐行读批处理垫片的，入口删完目录退出之后，cmd 读不到垫片的下一行，
 *    整条命令以「系统找不到指定的路径」+ 退出码 1 收场（2026-11-23 实测，目录其实已经删干净）。
 * 2. **顺带的收益**：刚克隆、还没 `pnpm install` 的仓库里 `pnpm walnut --list` / `--help` 就已经能用，
 *    agent 不必先装依赖才能知道有哪些命令。这要求入口的运行期依赖图只有 `node:*` 内置模块
 *    （`@clack/prompts` 是惰性 import，只在真正进多选时才需要它）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足 / 3 未验证）——
 * 见 `src/lib/cli.ts`。第 3 态是「有命令按设计没跑（环境缺失）」，它**不是**通过：汇总里会单列。
 */
import process from 'node:process'
import { runCli } from '../src/lib/cli.ts'
import { main } from '../src/run/main.ts'

await runCli(() => main(process.argv.slice(2)))
