import { Module } from '@nestjs/common'

import { DatabaseModule } from '@/infrastructure/database/database.module'

// EnvModule e LoggerModule são @Global(): seus exports (EnvService,
// LoggerService) já estão disponíveis para injeção sem reimportar aqui.
// Controllers (um por caso de uso) e use cases entram neste módulo conforme as
// features forem criadas — nunca em um módulo por bounded context.
@Module({
  imports: [DatabaseModule],
  controllers: [],
  providers: [],
})
export class HttpModule {}
