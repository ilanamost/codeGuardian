import { describe, expect, it, vi } from 'vitest'
import { AppError } from '../../src/models/app-error'
import { AppSettings } from '../../src/models/settings.model'
import type { NotificationPreference } from '../../src/models/dto'
import { createNotificationService, preferenceFor } from '../../src/services/notification.service'
import { ERROR_CODE, type ErrorCode } from '../../src/utils/error-messages'

function setup(now = () => 0) {
  const toast = { success: vi.fn(), error: vi.fn() }
  return { toast, service: createNotificationService({ toast, now }) }
}

const allOn: NotificationPreference = AppSettings.defaultDto().notification
const allOff: NotificationPreference = { reviewCompleted: false, reviewFailed: false, criticalFinding: false, email: false }

function errorFor(code: ErrorCode, kind: AppError['kind'] = 'unknown') {
  return new AppError({ code, kind })
}

describe('notification.service error gating', () => {
  it('shows a review error when Review failed is on', () => {
    const { toast, service } = setup()

    expect(service.notifyError(errorFor(ERROR_CODE.reviewSave), allOn)).toBe(true)
    expect(toast.error).toHaveBeenCalledWith('Could not save the review. Please try again.')
  })

  it('hides review errors when Review failed is off', () => {
    const { toast, service } = setup()

    for (const code of [ERROR_CODE.reviewLoad, ERROR_CODE.reviewSave, ERROR_CODE.reviewDelete, ERROR_CODE.reviewRename, ERROR_CODE.reportPdf]) {
      expect(service.notifyError(errorFor(code), { ...allOn, reviewFailed: false })).toBe(false)
    }
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('always shows errors that are not about a review', () => {
    const { toast, service } = setup()

    for (const code of [ERROR_CODE.network, ERROR_CODE.storage, ERROR_CODE.githubConnect, ERROR_CODE.supportSubmit, ERROR_CODE.settingsSave, ERROR_CODE.dashboardLoad]) {
      expect(service.notifyError(errorFor(code), allOff)).toBe(true)
    }
    expect(toast.error).toHaveBeenCalledTimes(6)
  })

  it('never shows a cancelled request', () => {
    const { toast, service } = setup()

    expect(service.notifyError(errorFor(ERROR_CODE.abort, 'abort'), allOn)).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('collapses the same error code within 2 seconds', () => {
    let time = 1000
    const { toast, service } = setup(() => time)

    service.notifyError(errorFor(ERROR_CODE.network), allOn)
    time += 1999
    expect(service.notifyError(errorFor(ERROR_CODE.network), allOn)).toBe(false)
    expect(service.notifyError(errorFor(ERROR_CODE.storage), allOn)).toBe(true)
    time += 1
    expect(service.notifyError(errorFor(ERROR_CODE.network), allOn)).toBe(true)
    expect(toast.error).toHaveBeenCalledTimes(3)
  })

  it('does not count a suppressed error toward the de-duplication window', () => {
    const { toast, service } = setup()

    service.notifyError(errorFor(ERROR_CODE.reviewLoad), { ...allOn, reviewFailed: false })
    expect(service.notifyError(errorFor(ERROR_CODE.reviewLoad), allOn)).toBe(true)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })

  it('maps review codes to the Review failed preference only', () => {
    expect(preferenceFor(errorFor(ERROR_CODE.reportPdf))).toBe('reviewFailed')
    expect(preferenceFor(errorFor(ERROR_CODE.network, 'network'))).toBeNull()
  })

  it.each(['network', 'timeout', 'storage'] as const)(
    'always shows a %s failure during a review action, even when Review failed is off',
    (kind) => {
      const { toast, service } = setup()
      const error = new AppError({ code: kind === 'storage' ? ERROR_CODE.storage : ERROR_CODE[kind], kind }).forAction(ERROR_CODE.reviewSave)

      expect(preferenceFor(error)).toBeNull()
      expect(service.notifyError(error, { ...allOn, reviewFailed: false })).toBe(true)
      expect(toast.error).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    ['not found', ERROR_CODE.notFound, 'http'],
    ['validation', ERROR_CODE.validation, 'validation'],
    ['server', ERROR_CODE.server, 'http']
  ] as const)('hides a %s failure of a review action when Review failed is off', (_, code, kind) => {
    const { toast, service } = setup()
    const error = new AppError({ code, kind }).forAction(ERROR_CODE.reviewLoad)

    expect(service.notifyError(error, { ...allOn, reviewFailed: false })).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('notification.service notices', () => {
  it('shows critical-finding notices only when that preference is on', () => {
    const { toast, service } = setup()

    expect(service.notifyCriticalFinding('Critical security finding detected', { ...allOn, criticalFinding: false })).toBe(false)
    expect(service.notifyCriticalFinding('Critical security finding detected', allOn)).toBe(true)
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('shows Review failed notices as errors and others as success', () => {
    const { toast, service } = setup()

    service.notify('reviewFailed', 'Review failed', allOn)
    service.notify('reviewCompleted', 'Review completed', allOn)
    service.notify('email', 'Email notification sent', allOn)

    expect(toast.error).toHaveBeenCalledWith('Review failed')
    expect(toast.success).toHaveBeenCalledWith('Review completed')
    expect(toast.success).not.toHaveBeenCalledWith('Email notification sent')
  })
})
