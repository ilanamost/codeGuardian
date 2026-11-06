import type { SupportErrors, SupportRequest } from '../types'
import { FORM_ERROR_MESSAGE } from '../utils/error-messages'

export const descriptionMin = 10
export const descriptionMax = 2000
// QA 032 F1: the backend accepts at most 254 characters (RFC 5321 path limit).
export const emailMax = 254

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const reviewIdPattern = /^[A-Za-z0-9-]+$/

export function validateSupportRequest(request: SupportRequest): SupportErrors {
  const errors: SupportErrors = {}
  if (!request.issueType) errors.issueType = FORM_ERROR_MESSAGE.issueTypeRequired
  if (!request.email.trim()) errors.email = FORM_ERROR_MESSAGE.emailRequired
  else if (request.email.trim().length > emailMax) errors.email = FORM_ERROR_MESSAGE.supportEmailTooLong(emailMax)
  else if (!emailPattern.test(request.email.trim())) errors.email = FORM_ERROR_MESSAGE.emailInvalid
  if (request.reviewId.trim() && !reviewIdPattern.test(request.reviewId.trim())) {
    errors.reviewId = FORM_ERROR_MESSAGE.reviewIdInvalid
  }
  const description = request.description.trim()
  if (!description) errors.description = FORM_ERROR_MESSAGE.descriptionRequired
  else if (description.length < descriptionMin) errors.description = FORM_ERROR_MESSAGE.descriptionTooShort(descriptionMin)
  else if (description.length > descriptionMax) errors.description = FORM_ERROR_MESSAGE.descriptionTooLong(descriptionMax)
  return errors
}
