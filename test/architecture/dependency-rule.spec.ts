import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const SRC_DIR = join(process.cwd(), 'src')
const CORE_DIR = join(process.cwd(), 'src/core')
const DOMAIN_DIR = join(process.cwd(), 'src/domain')
const IMPORT_SOURCE_REGEX = /from\s+['"]([^'"]+)['"]/g
const MODULE_DECORATOR_REGEX = /@Module\(/

// core só pode depender de builtins do Node e de si mesmo — qualquer outra
// coisa (pacote externo, domain, infrastructure) é violação de camada.
const CORE_ALLOWED_IMPORT_PATTERNS = [/^node:/, /^@\/core\//]
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

/**
 * Normaliza um import relativo (`../../infrastructure/x`) para a mesma forma
 * que um import por alias assumiria (`@/infrastructure/x`), resolvendo-o
 * contra o diretório do arquivo que o declara. Um import por alias, que já
 * começa com `@/` ou é um pacote (`zod`, `node:crypto`, ...), volta
 * inalterado. Sem isto, um import relativo escaparia às regras de camada
 * abaixo mesmo violando exatamente a mesma regra que o alias equivalente.
 */
function normalizeSource(filePath: string, source: string): string {
  if (!source.startsWith('.')) return source

  const resolved = resolve(dirname(filePath), source)
  const relativeToSrc = relative(SRC_DIR, resolved).split(sep).join('/')

  return `@/${relativeToSrc}`
}

function violationsIn(dir: string, patterns: RegExp[]): string[] {
  const violations: string[] = []

  for (const file of listTsFiles(dir)) {
    // Wiring de módulo legitimamente alcança a infraestrutura para amarrar
    // implementações concretas, e specs usam repositórios in-memory como test
    // double — esta regra audita o layering do código de produção.
    if (file.endsWith('.module.ts') || file.endsWith('.spec.ts')) continue

    for (const source of importSourcesOf(file)) {
      const normalized = normalizeSource(file, source)

      if (patterns.some((pattern) => pattern.test(normalized))) {
        violations.push(`${file} imports "${source}"`)
      }
    }
  }

  return violations
}

function coreAllowlistViolations(): string[] {
  const violations: string[] = []

  for (const file of listTsFiles(CORE_DIR)) {
    // Mesma exceção de wiring/test double do violationsIn acima.
    if (file.endsWith('.module.ts') || file.endsWith('.spec.ts')) continue

    for (const source of importSourcesOf(file)) {
      const normalized = normalizeSource(file, source)

      if (
        !CORE_ALLOWED_IMPORT_PATTERNS.some((pattern) =>
          pattern.test(normalized),
        )
      ) {
        violations.push(`${file} imports "${source}"`)
      }
    }
  }

  return violations
}

function domainModuleFileViolations(): string[] {
  return listTsFiles(DOMAIN_DIR).filter((file) => file.endsWith('.module.ts'))
}

function domainModuleDecoratorViolations(): string[] {
  const violations: string[] = []

  for (const file of listTsFiles(DOMAIN_DIR)) {
    if (file.endsWith('.spec.ts')) continue

    if (MODULE_DECORATOR_REGEX.test(readFileSync(file, 'utf-8'))) {
      violations.push(file)
    }
  }

  return violations
}

describe('dependency rule: src/core is framework-agnostic', () => {
  it('core only imports node builtins and other core modules', () => {
    expect(coreAllowlistViolations()).toEqual([])
  })
})

describe('dependency rule: src/domain never imports infrastructure', () => {
  it('domain code has no infrastructure imports, including via relative paths', () => {
    expect(violationsIn(DOMAIN_DIR, FORBIDDEN_DOMAIN_IMPORT_PATTERNS)).toEqual(
      [],
    )
  })
})

describe('dependency rule: src/domain has no NestJS modules', () => {
  it('no file under domain/ is named *.module.ts', () => {
    expect(domainModuleFileViolations()).toEqual([])
  })

  it('no file under domain/ declares a @Module(...) decorator', () => {
    expect(domainModuleDecoratorViolations()).toEqual([])
  })
})
