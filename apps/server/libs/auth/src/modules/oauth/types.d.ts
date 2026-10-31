declare global {
  interface IWalnutAdminOAuthGiteeUserInfo {
    id: string
    name: string
    avatar_url: string
    email: string
    provider: string
  }

  interface IWalnutAdminOAuthGitHubUserInfo {
    id: string
    login: string
    avatar_url: string
    email: string
    provider: string
  }
}

export {}
