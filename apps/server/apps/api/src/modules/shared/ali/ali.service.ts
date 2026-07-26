import * as $OpenApi from '@alicloud/openapi-client'
import Sts20150401, * as $Sts20150401 from '@alicloud/sts20150401'
import { Injectable } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { WalnutAdminConstRole } from '@walnut-server/const/role/index'

async function generateSTSToken(accessKeyId: string, accessKeySecret: string, endpoint: string, roleArn: string, roleSessionName: string, policy?: string) {
  const config = new $OpenApi.Config({
    accessKeyId,
    accessKeySecret,
    endpoint,
  })

  const client = new Sts20150401(config)

  const assumeRole = new $Sts20150401.AssumeRoleRequest({
    roleArn,
    roleSessionName,
    policy,
  })

  const res = await client.assumeRole(assumeRole)

  return res
}

@Injectable()
export class SharedAliService {
  constructor(private readonly configService: ConfigService) {}

  async getSTSToken(user: IWalnutAdminAccessTokenPayload) {
    const { id, secret, region, bucket, endPoint, roleArn, roleSessionName }
      = this.configService.get<{
        region: string
        bucket: string
        id: string
        secret: string
        endPoint: string
        roleArn: string
        roleSessionName: string
      }>('vendor.ali.OSS')!

    // read only policy
    const policy = JSON.stringify({
      Statement: [
        {
          Effect: 'Allow',
          Action: ['oss:GetObject', 'oss:ListObjects'],
          Resource: '*',
        },
      ],
      Version: '1',
    })

    const res = await generateSTSToken(
      id,
      secret,
      endPoint,
      roleArn,
      roleSessionName,
      user.currentRoleName === WalnutAdminConstRole.VISITOR ? policy : undefined,
    )

    return {
      accessKeyId: res.body?.credentials?.accessKeyId,
      accessKeySecret: res.body?.credentials?.accessKeySecret,
      stsToken: res.body?.credentials?.securityToken,
      region,
      bucket,
    }
  }
}
