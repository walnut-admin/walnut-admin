/**
 * AES-GCM wire format constants.
 * These values MUST be identical between frontend (Web Crypto) and backend (Node crypto)
 * for encryption/decryption interoperability.
 */
export const AES_GCM_WIRE = {
  /** Initialization Vector length in bytes (96-bit IV recommended for GCM) */
  IV_LENGTH: 12,
  /** Authentication tag length in bytes (128-bit tag for GCM) */
  TAG_LENGTH: 16,
  /** Minimum encrypted payload length in bytes (IV + TAG, no ciphertext) */
  MIN_PAYLOAD_LENGTH: 28, // IV_LENGTH(12) + TAG_LENGTH(16)
} as const
