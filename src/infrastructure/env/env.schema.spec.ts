import { describe, expect, it } from 'vitest'

import { envSchema } from '@/infrastructure/env/env.schema'

describe('envSchema', () => {
  it('aplica os defaults quando nada é informado', () => {
    const env = envSchema.parse({})

    expect(env.NODE_ENV).toBe('development')
    expect(env.PORT).toBe(3333)
    expect(env.CORS_ORIGIN).toBe('*')
  })

  it('coage PORT numérico vindo de string', () => {
    expect(envSchema.parse({ PORT: '4000' }).PORT).toBe(4000)
  })

  it('rejeita NODE_ENV fora do enum', () => {
    expect(() => envSchema.parse({ NODE_ENV: 'staging' })).toThrow()
  })
})
