import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface'

import type { EnvService } from '@/infrastructure/env/env.service'

export function corsConfig(envService: EnvService): CorsOptions {
  const origin = envService.get('CORS_ORIGIN')

  return {
    origin:
      origin === '*' ? true : origin.split(',').map((value) => value.trim()),
  }
}
