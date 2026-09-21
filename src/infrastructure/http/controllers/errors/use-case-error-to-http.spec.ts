import {
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { NotAllowedError } from '@/core/errors/not-allowed-error'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import type { UseCaseError } from '@/core/errors/use-case-error'
import { useCaseErrorToHttp } from '@/infrastructure/http/controllers/errors/use-case-error-to-http'

class UnknownError extends Error implements UseCaseError {
  constructor() {
    super('boom')
  }
}

describe('useCaseErrorToHttp', () => {
  it('mapeia ResourceNotFoundError para 404', () => {
    expect(useCaseErrorToHttp(new ResourceNotFoundError())).toBeInstanceOf(
      NotFoundException,
    )
  })

  it('mapeia NotAllowedError para 401', () => {
    expect(useCaseErrorToHttp(new NotAllowedError())).toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('cai em 500 genérico para erro não mapeado, sem vazar a mensagem', () => {
    const exception = useCaseErrorToHttp(new UnknownError())

    expect(exception).toBeInstanceOf(InternalServerErrorException)
    expect(JSON.stringify(exception.getResponse())).not.toContain('boom')
  })
})
