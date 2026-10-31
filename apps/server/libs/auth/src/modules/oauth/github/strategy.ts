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
  options.authorizationURL = 'https://github.com/login/oauth/authorize'
  options.tokenURL = 'https://github.com/login/oauth/access_token'

  OAuth2Strategy.call(this, options, verify)
  this.name = 'github'
  this._userProfileURL = 'https://api.github.com/user'
  this._userEmailURL = 'https://api.github.com/user/emails'
  // LINE below cannot delete
  this._oauth2.useAuthorizationHeaderforGET(true)
}

inherits(Strategy, OAuth2Strategy)

Strategy.prototype.userProfile = function (accessToken, done) {
  const self = this

  this._oauth2.get(
    this._userProfileURL,
    accessToken,
    (err, body, _res) => {
      if (err) {
        return done(
          new InternalOAuthError('Failed to fetch user profile', err),
        )
      }

      try {
        const profile = JSON.parse(body)

        self._oauth2.get(
          self._userEmailURL,
          accessToken,
          (err, body, _res) => {
            if (err) {
              return done(null, Object.assign(profile, { provider: 'github' }))
            }

            const emailArr: OAuthGitHubEmailItem[] = JSON.parse(body)

            if (emailArr.length === 0) {
              return done(null, Object.assign(profile, { provider: 'github' }))
            }

            const mainEmail = emailArr.find(i => i.primary && i.verified)

            if (!mainEmail) {
              return done(null, Object.assign(profile, { provider: 'github' }))
            }

            return done(
              null,
              Object.assign(profile, {
                provider: 'github',
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

interface OAuthGitHubEmailItem {
  email: string
  primary: boolean
  verified: boolean
}

// Note: OAuthGitHubUserInfo interface has been moved to @walnut-server/types/walnut-admin/oauth.d.ts
// as IWalnutAdminOAuthGitHubUserInfo
