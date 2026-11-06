import { AVATAR } from '../utils/constants.js'

// Profile photo type checks (plan 028, Scope 17): the type comes from the file's magic bytes,
// never from the client's MIME type or file name. Only PNG, JPEG and WebP; SVG (text that can
// hold script) and everything else is refused.

export type AvatarType = (typeof AVATAR.typeList)[number]

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const jpegSignature = [0xff, 0xd8, 0xff]
// `RIFF` <4 size bytes> `WEBP`
const riffSignature = [0x52, 0x49, 0x46, 0x46]
const webpSignature = [0x57, 0x45, 0x42, 0x50]
const webpOffset = 8

function startsWith(data: Buffer, signature: number[], offset = 0): boolean {
  return data.length >= offset + signature.length && signature.every((byte, index) => data[offset + index] === byte)
}

export function sniffAvatarType(data: Buffer): AvatarType | undefined {
  if (startsWith(data, pngSignature)) return 'image/png'
  if (startsWith(data, jpegSignature)) return 'image/jpeg'
  if (startsWith(data, riffSignature) && startsWith(data, webpSignature, webpOffset)) return 'image/webp'
  return undefined
}

export function isAvatarType(value: string): value is AvatarType {
  return (AVATAR.typeList as readonly string[]).includes(value)
}

// `/api/account/avatar?v=<digest prefix>`: a new photo gets a new URL, so caches never serve
// the old one.
export function avatarUrlOf(digest: string | null): string | null {
  return digest ? `${AVATAR.urlPrefix}${digest.slice(0, AVATAR.digestPrefixLength)}` : null
}
