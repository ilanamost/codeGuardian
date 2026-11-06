import { useState } from 'react'
import { ACCOUNT_TEXT } from '../lib/account.constants'
import { useAvatarSrc } from '../lib/useAvatarSrc'
import { initialsOf } from '../models/account.model'
import type { AccountDto } from '../models/dto'

type Props = {
  account: Pick<AccountDto, 'fullName' | 'avatarUrl'>
  size: 'small' | 'large'
  // A photo shown instead of the account's own (the preview before upload).
  previewSrc?: string
  alt?: string
}

const sizeClass = {
  small: 'size-9 text-xs',
  large: 'size-16 text-lg'
} as const

// The profile photo (plan 028), or the initials when there is none or it cannot be loaded. The
// same component in the Account panel and the sidebar, so both change together. Plan 033: the
// backend's photo is shown from an object URL (lib/useAvatarSrc.ts).
export default function ProfilePhoto({ account, size, previewSrc, alt = ACCOUNT_TEXT.profileImage }: Props) {
  const avatarSrc = useAvatarSrc(account.avatarUrl)
  const src = previewSrc ?? avatarSrc
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (src && failedSrc !== src) {
    return <img src={src} alt={alt} onError={() => setFailedSrc(src)} className={`${sizeClass[size]} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span
      role="img"
      aria-label={alt}
      className={`flex ${sizeClass[size]} shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary`}
    >
      {initialsOf(account.fullName)}
    </span>
  )
}
