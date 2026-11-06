import { downloadReportPdf } from '../lib/reportPdf'
import type { ReviewDto } from '../models/dto'

// The PDF report is built in the browser (jspdf, lib/reportPdf.ts) in both modes; no endpoint.
export interface ReportService {
  download(id: string, review: ReviewDto, language: string): Promise<void>
}

export function createReportService(): ReportService {
  return {
    download: (id, review, language) => downloadReportPdf(id, review, language)
  }
}
