import type { PipeTransform } from '@nestjs/common'
import { Injectable, UnprocessableEntityException } from '@nestjs/common'
import type { ZodType } from 'zod'

import { buildZodErrorContract } from '@/infrastructure/validation/zod-error-contract'

@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value)

    if (!result.success) {
      throw new UnprocessableEntityException(
        buildZodErrorContract({ error: result.error }),
      )
    }

    return result.data
  }
}
