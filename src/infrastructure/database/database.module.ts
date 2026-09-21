import { Global, Module } from '@nestjs/common'

// Ponto único de binding de persistência:
// `{ provide: XRepository, useClass: PrismaXRepository }` — um por contrato de
// repositório, conforme os bounded contexts forem criados.
@Global()
@Module({
  providers: [],
  exports: [],
})
export class DatabaseModule {}
