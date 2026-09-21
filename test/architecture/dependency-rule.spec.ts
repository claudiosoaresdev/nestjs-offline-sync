import { readdirSync, readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CORE_DIR = join(process.cwd(), 'src/core')
const DOMAIN_DIR = join(process.cwd(), 'src/domain')
const IMPORT_SOURCE_REGEX = /from\s+['"]([^'"]+)['"]/g
const FORBIDDEN_CORE_IMPORT_PATTERNS = [
  /^@nestjs\//,
  /^@prisma\//,
  /^@\/domain\//,
  /^@\/infrastructure\//,
]
const FORBIDDEN_DOMAIN_IMPORT_PATTERNS = [/^@\/infrastructure\//]

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []

  return readdirSync(dir, { recursive: true })
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.endsWith('.ts'),
    )
    .map((entry) => join(dir, entry))
}

function importSourcesOf(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf-8')
  return [...content.matchAll(IMPORT_SOURCE_REGEX)].map((match) => match[1])
}

function violationsIn(dir: string, patterns: RegExp[]): string[] {
  const violations: string[] = []

  for (const file of listTsFiles(dir)) {
    // Wiring de módulo legitimamente alcança a infraestrutura para amarrar
    // implementações concretas, e specs usam repositórios in-memory como test
    // double — esta regra audita o layering do código de produção.
    if (file.endsWith('.module.ts') || file.endsWith('.spec.ts')) continue

    for (const source of importSourcesOf(file)) {
      if (patterns.some((pattern) => pattern.test(source))) {
        violations.push(`${file} imports "${source}"`)
      }
    }
  }

  return violations
}

describe('dependency rule: src/core is framework-agnostic', () => {
  it('core never imports Nest, Prisma, domain or infrastructure', () => {
    expect(violationsIn(CORE_DIR, FORBIDDEN_CORE_IMPORT_PATTERNS)).toEqual([])
  })
})

describe('dependency rule: src/domain never imports infrastructure', () => {
  it('domain code has no infrastructure imports', () => {
    expect(violationsIn(DOMAIN_DIR, FORBIDDEN_DOMAIN_IMPORT_PATTERNS)).toEqual(
      [],
    )
  })
})
