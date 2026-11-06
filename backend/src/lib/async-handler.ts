import type { NextFunction, Request, RequestHandler, Response } from 'express'

// Express 4 does not forward rejected promises to the error handler, so async routes go
// through this wrapper.
export function asyncHandler(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next)
  }
}
