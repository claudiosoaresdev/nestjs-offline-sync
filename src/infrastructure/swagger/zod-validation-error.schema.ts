/**
 * Shape actually thrown by ZodValidationPipe (buildZodErrorContract) — differs
 * from useCaseErrorToHttp's `{code, message}` shape, so any endpoint with a
 * Zod-validated body or query can return this same 422 alongside a domain error.
 *
 * Typed loosely on purpose: @nestjs/swagger doesn't publicly export its
 * OpenAPI SchemaObject type (only via a deep `dist/` import blocked by the
 * package's own `exports` field), and this value is only ever consumed by
 * `@ApiResponse({ schema })`/`schema.oneOf`, which accept a plain object.
 */
export const zodValidationErrorSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    message: { type: 'string', example: 'Validation failed' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string', example: 'items.0.quantity' },
          message: {
            type: 'string',
            example: 'Number must be greater than or equal to 1',
          },
        },
      },
    },
  },
}
