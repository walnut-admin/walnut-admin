export { AliyunSmsModule } from './aliyun/aliyun.sms.module'
export { type AliyunSendSmsDto, AliyunSmsService, AliyunSmsTemplateCode, type AliyunSmsTemplateCodeType, type AliyunVerifySmsDto } from './aliyun/aliyun.sms.service'
export { AppSmsModule } from './sms.module'
export { AppSmsProcessor } from './sms.processor'
export { AppSmsService } from './sms.service'

// 刻意不从 barrel 导出 tencent/tencent.sms.service：
// 该文件自述「仅作为代码留存，不再被任何模块引入」（阿里云已取代）。此前它是死代码，
// 运行期从不加载 `tencentcloud-sdk-nodejs`；一旦经 barrel 重导出，任何 import
// '@walnut-server/sms' 都会在启动时 require 整包 SDK（本机实测约 0.7s + 常驻内存），
// 属于解耦不该带出的语义变化。需要时用子路径 `@walnut-server/sms/tencent/tencent.sms.service`。
