import { Buffer } from "buffer";
/** Web Crypto caps each getRandomValues call at 65536 bytes. */
export function randomBytes(size: number): Buffer {
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size; offset += 65536) crypto.getRandomValues(bytes.subarray(offset, Math.min(size, offset + 65536)));
  return Buffer.from(bytes);
}
export const randomUUID = (): string => crypto.randomUUID();
