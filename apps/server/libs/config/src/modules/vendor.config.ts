import * as process from 'node:process'
import { registerAs } from '@nestjs/config'

export default registerAs('vendor', () => ({
  baidu: process.env.VENDOR_KEYS_BAIDU,

  ali: {
    OSS: {
      region: process.env.VENDOR_KEYS_ALI_OSS_REGION,
      bucket: process.env.VENDOR_KEYS_ALI_OSS_BUCKET,
      id: process.env.VENDOR_KEYS_ALI_OSS_ID,
      secret: process.env.VENDOR_KEYS_ALI_OSS_SECRET,
      endPoint: process.env.VENDOR_KEYS_ALI_OSS_ENDPOINT,
      roleArn: process.env.VENDOR_KEYS_ALI_OSS_ROLE_ARN,
      roleSessionName: process.env.VENDOR_KEYS_ALI_OSS_ROLE_SESSION_NAME,
    },
  },
}))
