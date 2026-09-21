import { Module } from '@nestjs/common'

import { DatabaseModule } from '@/infrastructure/database/database.module'
import { EnvModule } from '@/infrastructure/env/env.module'
import { HealthModule } from '@/infrastructure/health/health.module'
import { HttpModule } from '@/infrastructure/http/http.module'
import { LoggerModule } from '@/infrastructure/logger/logger.module'
import { RateLimitModule } from '@/infrastructure/rate-limit/rate-limit.module'

@Module({
  imports: [
    EnvModule,
    LoggerModule,
    RateLimitModule,
    HealthModule,
    DatabaseModule,
    HttpModule,
  ],
})
export class AppModule {}
