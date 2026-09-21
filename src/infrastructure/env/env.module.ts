import { Global, Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { envSchema } from '@/infrastructure/env/env.schema'
import { EnvService } from '@/infrastructure/env/env.service'

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => envSchema.parse(env),
    }),
  ],
  providers: [EnvService],
  exports: [EnvService],
})
export class EnvModule {}
