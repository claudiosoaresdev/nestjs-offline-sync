import { UnprocessableEntityException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { ZodValidationPipe } from '@/infrastructure/validation/zod-validation.pipe'

const schema = z.object({ name: z.string().min(1) })

describe('ZodValidationPipe', () => {
  it('devolve o valor parseado quando o schema passa', () => {
    const pipe = new ZodValidationPipe(schema)

    expect(pipe.transform({ name: 'ok' })).toEqual({ name: 'ok' })
  })

  it('lança 422 com o contrato de erro quando o schema falha', () => {
    const pipe = new ZodValidationPipe(schema)

    expect(() => pipe.transform({ name: '' })).toThrow(
      UnprocessableEntityException,
    )
  })
})
