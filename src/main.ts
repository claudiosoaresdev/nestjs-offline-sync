import { NestFactory } from '@nestjs/core'

import { AppModule } from '@/app.module'
import { corsConfig } from '@/infrastructure/cors/cors.config'
import { EnvService } from '@/infrastructure/env/env.service'
import { LoggerService } from '@/infrastructure/logger/logger.service'
import { setupSwagger } from '@/infrastructure/swagger/swagger.config'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const envService = app.get(EnvService)

  app.useLogger(app.get(LoggerService))
  app.enableCors(corsConfig(envService))
  setupSwagger(app, envService)

  const port = envService.get('PORT')
  await app.listen(port)
}
void bootstrap()
