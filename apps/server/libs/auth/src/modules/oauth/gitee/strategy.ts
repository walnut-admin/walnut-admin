/* eslint-disable ts/ban-ts-comment, ts/strict-boolean-expressions, ts/no-unsafe-argument, ts/no-unsafe-assignment, ts/no-unsafe-call, ts/no-unsafe-member-access, ts/no-unsafe-return --
   passport-oauth2 自定义策略的 vendored 实现（原型继承写法 + 未类型化，随 Gitee 策略原样保留）。
   只豁免类型类规则；no-restricted-imports 等分层规则对本文件仍然生效。 */
// @ts-nocheck
import OAuth2Strategy, { InternalOAuthError } from 'passport-oauth2'

function inherits(ctor, superCtor) {
  if (superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true,
      },
    })
  }
}

function Strategy(options, verify) {
  options = options || {}
  options.authorizationURL = 'https://gitee.com/oauth/authorize'
  options.tokenURL = 'https://gitee.com/oauth/token'

  OAuth2Strategy.call(this, options, verify)
  this.name = 'gitee'
  this._userProfileURL = 'https://gitee.com/api/v5/user'
  this._userEmailURL = 'https://gitee.com/api/v5/emails'
}

inherits(Strategy, OAuth2Strategy)

Strategy.prototype.userProfile = function (accessToken, done) {
  const self = this

  this._oauth2.get(
    this._userProfileURL,
    accessToken,
    (err1, body1, _res) => {
      if (err1) {
        return done(
          new InternalOAuthError('Failed to fetch user profile', err1),
        )
      }

      try {
        const profile = JSON.parse(body1)

        self._oauth2.get(
          self._userEmailURL,
          accessToken,
          (err2, body2, _res) => {
            if (err2) {
              return done(null, Object.assign(profile, { provider: 'gitee' }))
            }

            const emailArr: OAuthGiteebEmailItem[] = JSON.parse(body2)

            if (emailArr.length === 0) {
              return done(null, Object.assign(profile, { provider: 'gitee' }))
            }

            const mainEmail = emailArr.find(
              i =>
                i.scope.includes('primary')
                && i.state === 'confirmed',
            )

            if (!mainEmail) {
              return done(null, Object.assign(profile, { provider: 'gitee' }))
            }

            return done(
              null,
              Object.assign(profile, {
                provider: 'gitee',
                email: mainEmail.email,
              }),
            )
          },
        )
      }
      catch {
        return done(new Error('Failed to parse user profile'))
      }
    },
  )
}

export { Strategy }

interface OAuthGiteebEmailItem {
  email: string
  state: 'confirmed'
  scope: ('primary' | 'commmited' | 'secure' | 'notified')[]
}

// Note: OAuthGiteeUserInfo interface has been moved to @walnut-server/types/walnut-admin/oauth.d.ts
// as IWalnutAdminOAuthGiteeUserInfo
