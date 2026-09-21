import type { LoggerService as NestLoggerService } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import type { Logger } from 'pino'
import { pino } from 'pino'

import { EnvService } from '@/infrastructure/env/env.service'

@Injectable()
export class LoggerService implements NestLoggerService {
  private readonly logger: Logger

  constructor(envService: EnvService) {
    const nodeEnv = envService.get('NODE_ENV')

    this.logger = pino({
      level: nodeEnv === 'production' ? 'info' : 'debug',
      transport:
        nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
    })
  }

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, this.toMessage(message))
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, this.toMessage(message))
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, this.toMessage(message))
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, this.toMessage(message))
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, this.toMessage(message))
  }

  private toMessage(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message)
  }
}
