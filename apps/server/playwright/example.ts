import type { SandboxConfig } from './sandbox.service'
import process from 'node:process'
import { generateRandomIP } from './helpers/generator/realWorld/ip'
import { generateRandomLocale } from './helpers/generator/realWorld/locale'
import { generateRandomTimezone } from './helpers/generator/realWorld/timezone'
import { generateRandomUserAgent } from './helpers/generator/realWorld/ua'
import { PlaywrightSandboxService } from './sandbox.service'

/**
 * 简单使用示例 - 创建10个纯净沙盒环境
 */
async function main() {
  const service = new PlaywrightSandboxService()

  // 定义10个不同配置的沙盒
  const configs: SandboxConfig[] = Array.from({ length: 8 }, (_, i) => {
    const randomLocale = generateRandomLocale()
    const randomTimezone = generateRandomTimezone()
    const randomUserAgent = generateRandomUserAgent()

    return {
      id: i + 1,
      // 如果有代理服务器,可以这样配置
      // proxy: {
      //   server: `http://proxy${i + 1}.example.com:8080`,
      //   username: 'user',
      //   password: 'pass'
      // },
      locale: randomLocale,
      timezone: randomTimezone,
      userAgent: randomUserAgent,
      viewport: {
        width: 1920,
        height: 1080,
      },
    }
  })

  try {
    console.log('开始创建10个沙盒环境...')

    const sandboxes = await service.createSandboxes(configs)

    console.log(`✅ 成功创建 ${sandboxes.length} 个沙盒环境`)

    await Promise.all(
      sandboxes.map(async (sandbox) => {
        console.log(`沙盒 #${sandbox.id}:`)
        console.log(`  - 语言: ${sandbox.config.locale}`)
        console.log(`  - 时区: ${sandbox.config.timezone}`)
        console.log(`  - 视口: ${sandbox.config.viewport?.width}x${sandbox.config.viewport?.height}`)
        if (sandbox.config.proxy) {
          console.log(`  - 代理: ${sandbox.config.proxy.server}`)
        }

        const realWorldIP = await generateRandomIP()

        await sandbox.page.route('**', (route) => {
          const headers = route.request().headers()

          // 注入后端通常识别的真实 IP 头
          // 'X-Forwarded-For' 是最通用的标准
          headers['X-Forwarded-For'] = realWorldIP
          headers['X-Real-IP'] = realWorldIP

          // 继续发送请求（带上修改后的 headers）
          route.continue({ headers })
        })
      }),
    )

    // 可选: 让所有沙盒打开同一个页面
    // console.log('\n正在打开测试页面...');
    await service.navigateAll('https://127.0.0.1:3100')

    // 或者单独操作每个沙盒
    // for (const sandbox of sandboxes) {
    //   await sandbox.page.goto('https://example.com');
    //   console.log(`沙盒 #${sandbox.id} 已打开页面`);
    // }

    console.log('\n所有沙盒已就绪,保持运行状态...')
    console.log('按 Ctrl+C 退出')

    // 保持运行,等待手动退出
    await new Promise(() => {})
  }
  catch (error) {
    console.error('发生错误:', error)
  }
  finally {
    // 清理资源
    console.log('\n清理所有沙盒...')
    await service.closeAll()
    console.log('完成')
  }
}

// 处理退出信号
process.on('SIGINT', async () => {
  console.log('\n收到退出信号,正在清理...')
  process.exit(0)
})

// 运行
main()
