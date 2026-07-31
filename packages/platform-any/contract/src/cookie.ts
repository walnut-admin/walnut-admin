/**
 * Cookie key base names (without environment-dependent __Secure-/__Host- prefix).
 * The prefix logic is server-side only — see libs/const/app/cookie.ts.
 *
 * Frontend consumers: use these exact keys when reading cookies set by the server.
 * The server always writes cookies with the appropriate prefix for the current environment.
 */
export const WalnutAdminConstCookieKeys = {
  /** Device fingerprint identifier */
  DEVICE_ID: 'DEVICE_ID',
  /** CAP.js CAPTCHA token */
  CAPJS_TOKEN: 'CAPJS_TOKEN',
  /** Refresh token JTI (JWT ID) */
  RT_JTI: 'RT_JTI',
  /** Request signature ticket */
  SIGN_TICKET: 'SIGN_TICKET',
} as const
