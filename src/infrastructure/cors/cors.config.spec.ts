import { describe, expect, it } from 'vitest'

import { corsConfig } from '@/infrastructure/cors/cors.config'
import type { EnvService } from '@/infrastructure/env/env.service'

function envWith(origin: string): EnvService {
  return { get: () => origin } as unknown as EnvService
}

describe('corsConfig', () => {
  it('libera qualquer origem com "*"', () => {
    expect(corsConfig(envWith('*')).origin).toBe(true)
  })

  it('divide a lista de origens por vírgula e remove espaços', () => {
    expect(corsConfig(envWith('http://a.com, http://b.com')).origin).toEqual([
      'http://a.com',
      'http://b.com',
    ])
  })
})
