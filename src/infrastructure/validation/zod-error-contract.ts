import type { ZodError } from 'zod'

export interface ZodErrorContract {
  message: string
  errors: Array<{ path: string; message: string }>
}

export function buildZodErrorContract({
  error,
}: {
  error: ZodError
}): ZodErrorContract {
  return {
    message: 'Validation failed',
    errors: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  }
}
