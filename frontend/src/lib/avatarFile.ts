import { AVATAR_LIMIT, type AvatarType } from './account.constants'

// Profile photo checks before upload (plan 028, Scope 17), the same as the server's: the type
// comes from the file's magic bytes, never from its name or the browser's MIME type, so SVG,
// HTML renamed to .png and every other file is refused. The server checks again.

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const jpegSignature = [0xff, 0xd8, 0xff]
// `RIFF` <4 size bytes> `WEBP`
const riffSignature = [0x52, 0x49, 0x46, 0x46]
const webpSignature = [0x57, 0x45, 0x42, 0x50]
const webpOffset = 8
const headerByte = 12

function startsWith(data: Uint8Array, signature: number[], offset = 0): boolean {
  return data.length >= offset + signature.length && signature.every((byte, index) => data[offset + index] === byte)
}

export function sniffAvatarType(data: Uint8Array): AvatarType | undefined {
  if (startsWith(data, pngSignature)) return 'image/png'
  if (startsWith(data, jpegSignature)) return 'image/jpeg'
  if (startsWith(data, riffSignature) && startsWith(data, webpSignature, webpOffset)) return 'image/webp'
  return undefined
}

// Blob.arrayBuffer where the browser has it, FileReader otherwise.
export function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

export type AvatarCheck = { ok: true; type: AvatarType } | { ok: false; reason: 'empty' | 'size' | 'type' }

export async function checkAvatarFile(file: Blob): Promise<AvatarCheck> {
  if (file.size === 0) return { ok: false, reason: 'empty' }
  if (file.size > AVATAR_LIMIT.maxByte) return { ok: false, reason: 'size' }
  const type = sniffAvatarType(await readBytes(file.slice(0, headerByte)))
  return type ? { ok: true, type } : { ok: false, reason: 'type' }
}

// `data:<type>;base64,...` of the bytes (the preview before upload).
export function toDataUrl(data: Uint8Array, type: AvatarType): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < data.length; index += chunk) {
    binary += String.fromCharCode(...data.subarray(index, index + chunk))
  }
  return `data:${type};base64,${btoa(binary)}`
}
