import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { AVATAR_LIMIT } from '../../src/lib/account.constants'
import { checkAvatarFile, sniffAvatarType } from '../../src/lib/avatarFile'
import { avatarSrcOf } from '../../src/models/account.model'
import { AppError } from '../../src/models/app-error'
import { createFixtureDataSource } from '../utils/fixtureDataSource'
import { createStorageService } from '../../src/services/storage.service'
import { createAccountService } from '../../src/services/account.service'
import { createFakeServices } from '../utils/fakeServices'
import { renderWithStoreSettled, settle } from '../utils/renderWithStore'

// Plan 028, Scope 17: the profile photo. The type is checked on the magic bytes before upload
// (the server checks again), and a change shows at once in the Account panel and the sidebar.

// applyAccept: false, as when the user picks "All files" in the browser's file dialog.
vi.mock('@monaco-editor/react', () => ({ default: () => <div data-testid="monaco" /> }))

const pngByte = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]
const jpegByte = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10]
const webpByte = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]

const fileOf = (byte: number[] | string, name: string, type: string) => new File([typeof byte === 'string' ? byte : new Uint8Array(byte)], name, { type })

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('photo checks (magic bytes, size)', () => {
  it('recognizes PNG, JPEG and WebP by their bytes', () => {
    expect(sniffAvatarType(new Uint8Array(pngByte))).toBe('image/png')
    expect(sniffAvatarType(new Uint8Array(jpegByte))).toBe('image/jpeg')
    expect(sniffAvatarType(new Uint8Array(webpByte))).toBe('image/webp')
    expect(sniffAvatarType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined()
  })

  it('refuses SVG, HTML renamed to .png, an empty file and a file over 2 MB, whatever their name or type says', async () => {
    expect(await checkAvatarFile(fileOf('<svg/>', 'a.svg', 'image/svg+xml'))).toEqual({ ok: false, reason: 'type' })
    expect(await checkAvatarFile(fileOf('<html></html>', 'a.png', 'image/png'))).toEqual({ ok: false, reason: 'type' })
    expect(await checkAvatarFile(fileOf([], 'a.png', 'image/png'))).toEqual({ ok: false, reason: 'empty' })
    const big = new File([new Uint8Array(AVATAR_LIMIT.maxByte + 1)], 'big.png', { type: 'image/png' })
    expect(await checkAvatarFile(big)).toEqual({ ok: false, reason: 'size' })
    expect(await checkAvatarFile(fileOf(pngByte, 'photo.bin', ''))).toEqual({ ok: true, type: 'image/png' })
  })

  it('uses only the backend avatar path or an image data URL as the img src', () => {
    expect(avatarSrcOf('/api/account/avatar?v=abc123', 'http://localhost:3001/')).toBe('http://localhost:3001/api/account/avatar?v=abc123')
    expect(avatarSrcOf('data:image/png;base64,AAAA', 'x')).toBe('data:image/png;base64,AAAA')
    expect(avatarSrcOf('javascript:alert(1)', 'x')).toBeNull()
    expect(avatarSrcOf('https://evil.example/a.png', 'x')).toBeNull()
    expect(avatarSrcOf(null, 'x')).toBeNull()
  })
})

describe('Account panel photo', () => {
  async function openAccount(services = createFakeServices().services) {
    const result = await renderWithStoreSettled(<App />, { route: '/settings', services })
    return { ...result, services }
  }

  const photoInput = () => screen.getByLabelText(/Upload photo|Change photo/, { selector: 'input' })

  it('refuses a .txt file before upload, with a toast', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { services, toast } = createFakeServices()
    await openAccount(services)

    await user.upload(photoInput(), fileOf('hello', 'notes.txt', 'text/plain'))
    await settle()

    expect(services.account.uploadAvatar).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not upload the photo. Use a PNG, JPEG or WebP image.')
  })

  it('refuses a file over 2 MB before upload', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { services, toast } = createFakeServices()
    await openAccount(services)

    await user.upload(photoInput(), new File([new Uint8Array([...pngByte, ...new Array(AVATAR_LIMIT.maxByte).fill(0)])], 'big.png', { type: 'image/png' }))
    await settle()

    expect(services.account.uploadAvatar).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Could not upload the photo. The photo is over 2 MB. Choose a smaller image.')
  })

  it('previews a PNG, uploads it on Save, and the panel and the sidebar show the new photo', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { services } = await openAccount()
    const panel = within(screen.getByRole('tabpanel'))

    await user.upload(photoInput(), fileOf(pngByte, 'me.png', 'image/png'))
    await settle()
    expect(panel.getByRole('img', { name: 'New profile photo preview' })).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/))
    expect(services.account.uploadAvatar).not.toHaveBeenCalled()

    await user.click(panel.getByRole('button', { name: 'Save photo' }))
    await settle()

    expect(services.account.uploadAvatar).toHaveBeenCalledWith(expect.any(File), 'image/png')
    // Plan 033: the photo is loaded through the API's request path and shown from an object URL.
    expect(services.account.getAvatar).toHaveBeenCalledWith('/api/account/avatar?v=abc123', expect.any(AbortSignal))
    await waitFor(() => expect(panel.getByRole('img', { name: 'Profile image' })).toHaveAttribute('src', expect.stringMatching(/^blob:/)))
    expect(within(screen.getByTestId('sidebar-profile')).getByRole('img')).toHaveAttribute('src', expect.stringMatching(/^blob:/))
  })

  it('Cancel drops the preview; Remove photo brings the initials back', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { services } = createFakeServices()
    services.account.uploadAvatar.mockResolvedValue({ ...(await services.account.get()), avatarUrl: '/api/account/avatar?v=abc123' })
    await openAccount(services)
    const panel = within(screen.getByRole('tabpanel'))

    await user.upload(photoInput(), fileOf(pngByte, 'me.png', 'image/png'))
    await settle()
    await user.click(panel.getByRole('button', { name: 'Cancel' }))
    expect(panel.getByRole('img', { name: 'Profile image' })).toHaveTextContent('JD')

    await user.upload(photoInput(), fileOf(pngByte, 'me.png', 'image/png'))
    await settle()
    await user.click(panel.getByRole('button', { name: 'Save photo' }))
    await settle()
    await user.click(panel.getByRole('button', { name: 'Remove photo' }))
    await settle()

    expect(services.account.removeAvatar).toHaveBeenCalledTimes(1)
    expect(panel.getByRole('img', { name: 'Profile image' })).toHaveTextContent('JD')
    expect(within(screen.getByTestId('sidebar-profile')).getByRole('img')).toHaveTextContent('JD')
  })

  it('a server refusal (413) is one error toast with the size hint, and the preview stays', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { services, toast } = createFakeServices()
    services.account.uploadAvatar.mockRejectedValue(AppError.fromResponse(413, { error: { code: 'payload_too_large', message: 'x' } }))
    await openAccount(services)
    const panel = within(screen.getByRole('tabpanel'))

    await user.upload(photoInput(), fileOf(pngByte, 'me.png', 'image/png'))
    await settle()
    await user.click(panel.getByRole('button', { name: 'Save photo' }))
    await settle()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Could not upload the photo. The photo is over 2 MB. Choose a smaller image.')
    expect(panel.getByRole('button', { name: 'Save photo' })).toBeInTheDocument()
  })
})

describe('Photo on the fake backend (a data URL)', () => {
  function account() {
    return createAccountService(createFixtureDataSource({ storage: createStorageService(() => undefined) }))
  }

  it('stores a PNG as a data URL and removes it', async () => {
    const service = account()

    const uploaded = await service.uploadAvatar(fileOf(pngByte, 'me.png', 'image/png'), 'image/png')
    expect(uploaded.avatarUrl).toMatch(/^data:image\/png;base64,/)
    expect((await service.get()).avatarUrl).toBe(uploaded.avatarUrl)
    expect((await service.removeAvatar()).avatarUrl).toBeNull()
  })

  it('answers like the backend: 422 for a wrong or mismatched type, 413 over 2 MB', async () => {
    const service = account()

    await expect(service.uploadAvatar(fileOf('<svg/>', 'a.png', 'image/png'), 'image/png')).rejects.toMatchObject({ status: 422 })
    await expect(service.uploadAvatar(fileOf(pngByte, 'a.jpg', 'image/jpeg'), 'image/jpeg')).rejects.toMatchObject({ status: 422 })
    await expect(service.uploadAvatar(new Blob([new Uint8Array(AVATAR_LIMIT.maxByte + 1)]), 'image/png')).rejects.toMatchObject({ status: 413 })
    expect((await service.get()).avatarUrl).toBeNull()
  })

  it('the Account panel uploads to the fake backend and shows the stored photo', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await renderWithStoreSettled(<App />, { route: '/settings' })
    const panel = within(screen.getByRole('tabpanel'))

    await user.upload(screen.getByLabelText('Upload photo', { selector: 'input' }), fileOf(pngByte, 'me.png', 'image/png'))
    await settle()
    await user.click(panel.getByRole('button', { name: 'Save photo' }))
    await settle()

    expect(panel.getByRole('img', { name: 'Profile image' })).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/))
  })
})
