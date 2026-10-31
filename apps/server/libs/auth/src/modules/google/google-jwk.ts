import type { JWK } from 'jose'

/**
 * Google FedCM id_token 的 JWKS 快照（`https://www.googleapis.com/oauth2/v3/certs`）。
 *
 * 批 8：原文件在 `apps/api/src/public/json/google-jwk.json`，lib 内不能相对路径逃逸
 * 进 apps（ADR/ESLint libs-boundary），SWC 构建也不会把 JSON 隐式拷进 dist —— 因此
 * 改成 lib 内的 TS 常量。公开目录下的同名 JSON 仍保留（静态资源面不变），此处是
 * **编译期快照**；Google 轮换密钥时按下方 URL 更新本文件与公开副本。
 */
export const googleJwk: { keys: JWK[] } = {
  keys: [
    {
      alg: 'RS256',
      n: '24IIHpxk2q24EcrPd-u4JnRVtBXc49cjViy8LhNrkZQNwfwJ3MfW7fNTz_9_fpRb23DulFbHpGVoOoiNKtlS6hd74-SFCMbV305pUxLBSfmZWe5iMy8tjccgRDRG4Fxp_94gMO9Wm3IvdENTXwkHBHyKW4-8l5eOPC1FqhVnwjjj-LK5IwcQTy6b2MnfOqb5u--UzQI1_Qpm7u7JCcr81K-GCzGjQ9w7tYCavMmIiZ6AU5hXcSn1rUBUAURIoMP6ThUpTxQ4-7QbCKpP51cG2RXqIJiMzsFc0RdOSrJNLJxxS_0BmxADYsfxNydAeLaJ8WJs2I47pLOhwx7H-FdV_Q',
      kty: 'RSA',
      use: 'sig',
      e: 'AQAB',
      kid: '6a906ec119d7ba46a6a43ef1ea842e34a8ee08b4',
    },
    {
      kid: '496d008e8c7be1cae4209e0d5c21b050a61e960f',
      e: 'AQAB',
      n: 'nLFX9zZNqpLMgVGQ3WPbnwMTRo6AexegmSDsujoOQFkldYXdjFibe18IFky68nVtow-9AOMVkKYFoPA19_DP035iALm-jF2jmbsZiO5LFlxl91CH4y5jOZ85t2OJ77E8yGeY9xWFNAiizZpESk9ZAQ_siGsJbnyGD5M0bxgZNTp1wjzk6Nj_e00zOFYX0_lNXr8iizYnflXbMx-VRfcl_YP6jZ5Spvm3EAvWGQTziB6RcsAYvc7g6BIhVS92xlNtg1sfxWzlhVspjkGsCoELQaraBGWhqhB7rvgRvJOMoy_QzVmnyKTmh6RPNSp2ZYAe1c5LbZdJUWG-zgy1aUhqVw',
      kty: 'RSA',
      alg: 'RS256',
      use: 'sig',
    },
  ],
}
