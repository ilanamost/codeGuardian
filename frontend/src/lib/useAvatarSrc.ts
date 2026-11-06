import { useEffect, useState } from 'react'
import { avatarSrcOf, isAvatarPath } from '../models/account.model'
import { fetchAvatarSrc } from '../store/account.slice'
import { useAppDispatch } from '../store/hooks'

type Loaded = { avatarUrl: string; src: string | null }

// The `src` of the profile photo. The backend's photo is loaded through the API's one request
// path and shown from an object URL, revoked when the photo changes or the component goes away.
// A data URL (the preview) is used as it is. Null while loading, when there is no photo, or when
// it could not be loaded: the caller shows the initials.
export function useAvatarSrc(avatarUrl: string | null): string | null {
  const dispatch = useAppDispatch()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const fromApi = avatarUrl !== null && isAvatarPath(avatarUrl)

  useEffect(() => {
    if (!fromApi || avatarUrl === null) return
    let active = true
    let objectUrl: string | null = null
    const pending = dispatch(fetchAvatarSrc(avatarUrl))
    pending.unwrap().then(
      (src) => {
        if (!active) {
          URL.revokeObjectURL(src)
          return
        }
        objectUrl = src
        setLoaded({ avatarUrl, src })
      },
      () => {
        if (active) setLoaded({ avatarUrl, src: null })
      }
    )
    return () => {
      active = false
      pending.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [dispatch, avatarUrl, fromApi])

  if (!fromApi) return avatarSrcOf(avatarUrl, undefined)
  return loaded?.avatarUrl === avatarUrl ? loaded.src : null
}
