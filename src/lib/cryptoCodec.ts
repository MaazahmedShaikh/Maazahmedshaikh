import * as Crypto from 'expo-crypto';

const CIPHER_SECRET = process.env.EXPO_PUBLIC_CIPHER_SECRET || 'monsoon-copper-lantern-8841-vault';

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(256);
B64_LOOKUP.fill(255);
for (let i = 0; i < B64_CHARS.length; i++) {
  B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
}

/**
 * Encodes a Uint8Array into standard Base64 without Buffer/btoa dependencies.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < len;
    const hasB2 = i + 2 < len;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;
    const triplet = (b0 << 16) | (b1 << 8) | b2;

    chunks.push(
      B64_CHARS[(triplet >> 18) & 0x3f] +
        B64_CHARS[(triplet >> 12) & 0x3f] +
        (hasB1 ? B64_CHARS[(triplet >> 6) & 0x3f] : '=') +
        (hasB2 ? B64_CHARS[triplet & 0x3f] : '=')
    );
  }
  return chunks.join('');
}

/**
 * Decodes standard Base64 directly into a Uint8Array.
 */
function base64ToBytes(b64: string): Uint8Array {
  let validLen = b64.length;
  while (validLen > 0 && b64[validLen - 1] === '=') {
    validLen--;
  }
  const outLen = Math.floor((validLen * 3) / 4);
  const out = new Uint8Array(outLen);
  let outIdx = 0;

  for (let i = 0; i < validLen; i += 4) {
    const c0 = B64_LOOKUP[b64.charCodeAt(i)] & 0x3f;
    const c1 = i + 1 < validLen ? B64_LOOKUP[b64.charCodeAt(i + 1)] & 0x3f : 0;
    const c2 = i + 2 < validLen ? B64_LOOKUP[b64.charCodeAt(i + 2)] & 0x3f : 0;
    const c3 = i + 3 < validLen ? B64_LOOKUP[b64.charCodeAt(i + 3)] & 0x3f : 0;

    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (outIdx < outLen) out[outIdx++] = (triplet >> 16) & 0xff;
    if (outIdx < outLen) out[outIdx++] = (triplet >> 8) & 0xff;
    if (outIdx < outLen) out[outIdx++] = triplet & 0xff;
  }

  return out;
}

/**
 * Computes SHA-256 hash of a 4-digit PIN for thread authentication.
 */
export async function hashPin(pin: string): Promise<string> {
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin);
}

/**
 * Generates a random hex salt of specified length (default 16 chars = 8 bytes).
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
 * Converts a JS string to UTF-8 bytes.
 */
function stringToUtf8Bytes(str: string): Uint8Array {
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
  return new Uint8Array(bytes);
}

/**
 * Converts UTF-8 Uint8Array back to string in chunks to minimize GC overhead.
 */
function utf8BytesToString(bytes: Uint8Array | number[]): string {
  const codeUnits: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c >> 7 === 0) {
      codeUnits.push(c);
    } else if (c >> 5 === 0x06) {
      const c2 = bytes[i++];
      codeUnits.push(((c & 0x1f) << 6) | (c2 & 0x3f));
    } else if (c >> 4 === 0x0e) {
      const c2 = bytes[i++];
      const c3 = bytes[i++];
      codeUnits.push(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
    } else if (c >> 3 === 0x1e) {
      const c2 = bytes[i++];
      const c3 = bytes[i++];
      const c4 = bytes[i++];
      let u = ((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f);
      u -= 0x10000;
      codeUnits.push((u >> 10) + 0xd800, (u & 0x3ff) + 0xdc00);
    }
  }

  let result = '';
  const CHUNK_SIZE = 8192;
  for (let start = 0; start < codeUnits.length; start += CHUNK_SIZE) {
    result += String.fromCharCode(...codeUnits.slice(start, start + CHUNK_SIZE));
  }
  return result;
}

/**
 * Derives keystream bytes using iterative SHA-256 hashing (legacy ENC:v1 compatibility).
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
 * Fast stream expansion from a single 256-bit SHA-256 native digest (ENC:v2 / ENC:v3).
 */
async function deriveFastKeyStream(secret: string, salt: string, byteCount: number): Promise<Uint8Array> {
  const masterHex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${secret}:${salt}:v2`
  );
  let s0 = parseInt(masterHex.slice(0, 8), 16) >>> 0;
  let s1 = parseInt(masterHex.slice(8, 16), 16) >>> 0;
  let s2 = parseInt(masterHex.slice(16, 24), 16) >>> 0;
  let s3 = parseInt(masterHex.slice(24, 32), 16) >>> 0;
  let s4 = parseInt(masterHex.slice(32, 40), 16) >>> 0;
  let s5 = parseInt(masterHex.slice(40, 48), 16) >>> 0;
  let s6 = parseInt(masterHex.slice(48, 56), 16) >>> 0;
  let s7 = parseInt(masterHex.slice(56, 64), 16) >>> 0;

  const stream = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i += 4) {
    let t = s0 ^ (s0 << 11);
    t = (t ^ (t >>> 8)) >>> 0;
    s0 = s1;
    s1 = s2;
    s2 = s3;
    s3 = s4;
    s4 = s5;
    s5 = s6;
    s6 = s7;
    s7 = (s7 ^ (s7 >>> 19) ^ t) >>> 0;
    const word = (s7 + 0x9e3779b9) >>> 0;
    stream[i] = word & 0xff;
    if (i + 1 < byteCount) stream[i + 1] = (word >>> 8) & 0xff;
    if (i + 2 < byteCount) stream[i + 2] = (word >>> 16) & 0xff;
    if (i + 3 < byteCount) stream[i + 3] = (word >>> 24) & 0xff;
  }
  return stream;
}

/**
 * Encrypts a message using compact Base64 ciphertext (ENC:v3) for fast speed and low Postgres/Realtime RAM.
 * Result format: ENC:v3:<salt>:<base64Cipher>
 */
export async function encryptMessage(
  plainText: string,
  customSecret?: string
): Promise<string> {
  const secret = customSecret || CIPHER_SECRET;
  const salt = generateRandomHex(16);
  const plainBytes = stringToUtf8Bytes(plainText);
  const keyStream = await deriveFastKeyStream(secret, salt, plainBytes.length);

  const cipherBytes = new Uint8Array(plainBytes.length);
  for (let i = 0; i < plainBytes.length; i++) {
    cipherBytes[i] = plainBytes[i] ^ keyStream[i];
  }

  return `ENC:v3:${salt}:${bytesToBase64(cipherBytes)}`;
}

/**
 * Decrypts a message payload (supports compact ENC:v3 plus legacy ENC:v2 and ENC:v1).
 */
export async function decryptMessage(
  payload: string,
  customSecret?: string
): Promise<string> {
  if (
    !payload ||
    (!payload.startsWith('ENC:v1:') &&
      !payload.startsWith('ENC:v2:') &&
      !payload.startsWith('ENC:v3:'))
  ) {
    return payload || '';
  }

  try {
    const parts = payload.split(':');
    if (parts.length !== 4) {
      return '[Invalid Encrypted Payload]';
    }

    const version = parts[1];
    const salt = parts[2];
    const body = parts[3];
    const secret = customSecret || CIPHER_SECRET;

    if (version === 'v3') {
      const cipherBytes = base64ToBytes(body);
      const keyStream = await deriveFastKeyStream(secret, salt, cipherBytes.length);
      for (let i = 0; i < cipherBytes.length; i++) {
        cipherBytes[i] = cipherBytes[i] ^ keyStream[i];
      }
      return utf8BytesToString(cipherBytes);
    }

    const byteLen = Math.floor(body.length / 2);
    const cipherBytes = new Uint8Array(byteLen);
    for (let i = 0; i < byteLen; i++) {
      cipherBytes[i] = parseInt(body.substring(i * 2, i * 2 + 2), 16);
    }

    const keyStream =
      version === 'v2'
        ? await deriveFastKeyStream(secret, salt, byteLen)
        : await deriveKeyStream(secret, salt, byteLen);

    for (let i = 0; i < byteLen; i++) {
      cipherBytes[i] = cipherBytes[i] ^ keyStream[i];
    }

    return utf8BytesToString(cipherBytes);
  } catch (error) {
    console.error('Decryption failed:', error);
    return '[Decryption Error]';
  }
}
