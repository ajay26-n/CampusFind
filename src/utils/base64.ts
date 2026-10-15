/**
 * Decodes a base64 string into a standard ArrayBuffer.
 * Works seamlessly across React Native (Hermes / JavaScriptCore), Web, and Node.js environments
 * without requiring additional native dependencies.
 */
export function decodeBase64ToArrayBuffer(base64: string): ArrayBuffer {
  // Strip potential data URL prefix or whitespace
  const cleanBase64 = base64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '').trim();
  if (!cleanBase64) {
    return new ArrayBuffer(0);
  }

  // Fast path: if global atob is available (Hermes, Web, modern React Native)
  if (typeof globalThis.atob === 'function') {
    const binaryString = globalThis.atob(cleanBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Pure JavaScript lookup table fallback for engines where atob is not defined
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let bufferLength = cleanBase64.length * 0.75;
  if (cleanBase64[cleanBase64.length - 1] === '=') {
    bufferLength--;
    if (cleanBase64[cleanBase64.length - 2] === '=') {
      bufferLength--;
    }
  }

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < cleanBase64.length; i += 4) {
    const encoded1 = lookup[cleanBase64.charCodeAt(i)];
    const encoded2 = lookup[cleanBase64.charCodeAt(i + 1)];
    const encoded3 = lookup[cleanBase64.charCodeAt(i + 2)];
    const encoded4 = lookup[cleanBase64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (cleanBase64[i + 2] !== '=') {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (cleanBase64[i + 3] !== '=') {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }

  return bytes.buffer;
}
