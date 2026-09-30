import { badRequest, internalError, notFound } from '../lib/response'

/** Top-level error handler: malformed JSON bodies become 400, everything else a 500 envelope. */
export function handleAppError(err: Error): Response {
  // Hono's c.req.json() throws SyntaxError on malformed bodies; surface it as
  // 400 instead of a misleading 500 INTERNAL_ERROR.
  if (err instanceof SyntaxError) {
    return badRequest(`Invalid request body: ${err.message}`)
  }
  console.error('Unhandled error:', err)
  return internalError()
}

/** Fallback for unmatched routes. */
export function handleNotFound(): Response {
  return notFound('Route not found')
}
