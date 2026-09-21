import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

import type { EnvService } from '@/infrastructure/env/env.service'

export function setupSwagger(
  app: INestApplication,
  envService: EnvService,
): void {
  const nodeEnv = envService.get('NODE_ENV')
  const apiUrl =
    envService.get('API_URL') ?? `http://localhost:${envService.get('PORT')}`

  const config = new DocumentBuilder()
    .setTitle('Offline Sync API')
    .setDescription('API de sincronização offline-first.')
    .setVersion('1.0')
    .addServer(apiUrl, `Ambiente ${nodeEnv}`)
    .addTag('health', 'Liveness e readiness da aplicação')
    .setLicense('UNLICENSED', '')
    .build()

  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('docs', app, document)
}
