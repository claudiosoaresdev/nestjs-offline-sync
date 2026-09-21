import type { HttpException } from '@nestjs/common'
import {
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'

import { NotAllowedError } from '@/core/errors/not-allowed-error'
import { ResourceNotFoundError } from '@/core/errors/resource-not-found-error'
import type { UseCaseError } from '@/core/errors/use-case-error'

export function useCaseErrorToHttp(error: UseCaseError): HttpException {
  const message = error.message

  switch (error.constructor) {
    case ResourceNotFoundError:
      return new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message })
    case NotAllowedError:
      return new UnauthorizedException({ code: 'NOT_ALLOWED', message })
    default:
      return new InternalServerErrorException({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      })
  }
}
