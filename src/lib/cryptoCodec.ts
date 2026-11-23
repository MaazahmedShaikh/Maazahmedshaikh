import * as Crypto from 'expo-crypto';

const CIPHER_SECRET = process.env.EXPO_PUBLIC_CIPHER_SECRET || 'monsoon-copper-lantern-8841-vault';

/**
 * Computes SHA-256 hash of a 4-digit PIN for thread authentication
 */
export async function hashPin(pin: string): Promise<string> {
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
}

/**
 * Generates a random hex salt of specified length (default 16 chars = 8 bytes)
 */
function generateRandomHex(length = 16): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Converts a string to UTF-8 byte array
 */
function stringToUtf8Bytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) {
      bytes.push(charcode);
    } else if (charcode < 0x800) {
      bytes.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      bytes.push(
        0xe0 | (charcode >> 12),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return bytes;
}

/**
 * Converts UTF-8 byte array back to string
 */
function utf8BytesToString(bytes: number[]): string {
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c >> 7 === 0) {
      result += String.fromCharCode(c);
    } else if (c >> 5 === 0x06) {
      const c2 = bytes[i++];
      result += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
    } else if (c >> 4 === 0x0e) {
      const c2 = bytes[i++];
      const c3 = bytes[i++];
      result += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
    } else if (c >> 3 === 0x1e) {
      const c2 = bytes[i++];
      const c3 = bytes[i++];
      const c4 = bytes[i++];
      let u = ((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f);
      u -= 0x10000;
      result += String.fromCharCode((u >> 10) + 0xd800, (u & 0x3ff) + 0xdc00);
    }
  }
  return result;
}

/**
 * Derives keystream bytes using iterative SHA-256 hashing
 */
async function deriveKeyStream(secret: string, salt: string, byteCount: number): Promise<number[]> {
  const stream: number[] = [];
  let blockIndex = 0;

  while (stream.length < byteCount) {
    const blockSeed = `${secret}:${salt}:${blockIndex}`;
    const hashHex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, blockSeed);
    for (let i = 0; i < hashHex.length && stream.length < byteCount; i += 2) {
      stream.push(parseInt(hashHex.substring(i, i + 2), 16));
    }
    blockIndex++;
  }

  return stream;
}

/**
 * Encrypts a message using a SHA-256 stream cipher with random salt and EXPO_PUBLIC_CIPHER_SECRET.
 * Result format: ENC:v1:<salt>:<hexCipher>
 */
export async function encryptMessage(
  plainText: string,
  customSecret?: string
): Promise<string> {
  const secret = customSecret || CIPHER_SECRET;
  const salt = generateRandomHex(16);
  const plainBytes = stringToUtf8Bytes(plainText);
  const keyStream = await deriveKeyStream(secret, salt, plainBytes.length);

  let hexCipher = '';
  for (let i = 0; i < plainBytes.length; i++) {
    const xorVal = plainBytes[i] ^ keyStream[i];
    const hex = xorVal.toString(16).padStart(2, '0');
    hexCipher += hex;
  }

  return `ENC:v1:${salt}:${hexCipher}`;
}

/**
 * Decrypts a message payload. If not encrypted with ENC:v1, returns plaintext as-is.
 */
export async function decryptMessage(
  payload: string,
  customSecret?: string
): Promise<string> {
  if (!payload || !payload.startsWith('ENC:v1:')) {
    return payload || '';
  }

  try {
    const parts = payload.split(':');
    if (parts.length !== 4) {
      return '[Invalid Encrypted Payload]';
    }

    const salt = parts[2];
    const hexCipher = parts[3];
    const cipherBytes: number[] = [];
    for (let i = 0; i < hexCipher.length; i += 2) {
      cipherBytes.push(parseInt(hexCipher.substring(i, i + 2), 16));
    }

    const secret = customSecret || CIPHER_SECRET;
    const keyStream = await deriveKeyStream(secret, salt, cipherBytes.length);

    const decryptedBytes: number[] = [];
    for (let i = 0; i < cipherBytes.length; i++) {
      decryptedBytes.push(cipherBytes[i] ^ keyStream[i]);
    }

    return utf8BytesToString(decryptedBytes);
  } catch (error) {
    console.error('Decryption failed:', error);
    return '[Decryption Error]';
  }
}

