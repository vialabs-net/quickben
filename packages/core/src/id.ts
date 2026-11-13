let lastTime = 0;
let sequence = 0;

/**
 * Generate a UUIDv7 (RFC 9562). Ids from one process are strictly increasing: within the
 * same millisecond a 12-bit counter is incremented.
 */
export function uuidv7(now: number = Date.now()): string {
  let time = Math.max(now, lastTime);
  if (time === lastTime) {
    sequence += 1;
    if (sequence > 0xfff) {
      time += 1;
      sequence = 0;
    }
  } else {
    sequence = 0;
  }
  lastTime = time;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 48-bit big-endian Unix timestamp in milliseconds.
  let rest = time;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  // Version 7 + 12-bit sequence, then the RFC 4122 variant.
  bytes[6] = 0x70 | (sequence >> 8);
  bytes[7] = sequence & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
