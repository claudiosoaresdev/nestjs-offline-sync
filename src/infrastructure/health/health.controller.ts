import { Controller, Get } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { HealthCheckResult } from '@nestjs/terminus'
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { SkipThrottle } from '@nestjs/throttler'

const MAX_HEAP_BYTES = 300 * 1024 * 1024

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', MAX_HEAP_BYTES),
    ])
  }
}
