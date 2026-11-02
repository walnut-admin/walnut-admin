import * as $OpenApi from '@alicloud/openapi-client'
import Sts20150401, * as $Sts20150401 from '@alicloud/sts20150401'
import { Injectable } from '@nestjs/common'

import { ConfigService } from '@nestjs/config'
import { buildAliOSSStsPolicy } from './ali.policy'

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

    // F-12：**所有用户都必须带 policy**。以前非 visitor 传 undefined → STS 继承 roleArn
    // （默认 OSS FullAccess 角色）的全部权限，任何登录用户都能读写/删整个 bucket；visitor
    // 虽然带 policy，但 Resource 是 *。现在 visitor 只读、非 visitor 加上传动作，资源一律
    // 收窄到本 bucket（构造与三态说明见 ali.policy.ts 头注释）。
    //
    // objectKeyPrefix 传 null 的原因：admin 前端对象键是 `${folder}/${fileName}`（folder 是
    // 调用方 prop，默认 'example'），**不含 userId 前缀**，硬收窄会把上传打坏 —— 因此退化
    // 为 bucket 级 Action 白名单。等对象键带上用户前缀后改这里传前缀即可自动收窄。
    const policy = buildAliOSSStsPolicy({
      currentRoleName: user.currentRoleName,
      bucket,
      objectKeyPrefix: null,
    })

    const res = await generateSTSToken(
      id,
      secret,
      endPoint,
      roleArn,
      roleSessionName,
      policy,
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
