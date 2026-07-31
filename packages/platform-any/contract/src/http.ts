/**
 * Custom HTTP header constants — shared between frontend and backend.
 * Canonical casing: Pascal (e.g. X-Language), per HTTP spec convention.
 */

export const RequestHeaders = {
  AUTHORIZATION: 'Authorization',

  USER_AGENT: 'user-agent',

  ID: 'X-Request-ID',
  IP: 'X-Request-IP',
  LANGUAGE: 'X-Language',
  RES_TIME: 'X-Response-Time',
  TIMEZONE: 'X-Timezone',
  VERSION: 'X-Version',
  REPO_VERSION: 'X-Repo-Version',
  FINGERPRINT: 'X-Fingerprint',
  SIGN: 'X-Sign',
  SERIAL: 'X-Serial',
  TIMESTAMP: 'X-Timestamp',
  NONCE: 'X-Nonce',
} as const
