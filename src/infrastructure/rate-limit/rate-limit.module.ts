import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'

import { EnvModule } from '@/infrastructure/env/env.module'
import { EnvService } from '@/infrastructure/env/env.service'

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (envService: EnvService) => ({
        throttlers: [
          {
            ttl: envService.get('THROTTLE_TTL'),
            limit: envService.get('THROTTLE_LIMIT'),
          },
        ],
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
