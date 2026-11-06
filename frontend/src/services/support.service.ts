import { API_PATH } from '../lib/api.constants'
import { AppError } from '../models/app-error'
import type { SupportRequestDto, SupportTicketDto } from '../models/dto'
import { hasFields, isString } from '../models/guard'
import { parseDto } from '../models/review.model'
import { validateSupportRequest } from '../lib/validateSupportRequest'
import { ERROR_CODE } from '../utils/error-messages'
import { post, type DataSource } from './data-source'

// The request is validated again here so an invalid one never leaves the browser.
export interface SupportService {
  submit(request: SupportRequestDto): Promise<SupportTicketDto>
}

const isTicketDto = (value: unknown): value is SupportTicketDto => hasFields(value, { ticket: isString })

function assertValid(request: SupportRequestDto) {
  if (Object.keys(validateSupportRequest(request)).length > 0) {
    throw new AppError({ code: ERROR_CODE.validation, kind: 'validation', message: 'Invalid support request' })
  }
}

export function createSupportService(source: DataSource): SupportService {
  return {
    async submit(request) {
      assertValid(request)
      const body = { ...request, email: request.email.trim(), reviewId: request.reviewId.trim(), description: request.description.trim() }
      const dto = parseDto(await post<unknown>(source, API_PATH.supportRequest, body), isTicketDto)
      return { ticket: dto.ticket }
    }
  }
}
