/** @type {import('lint-staged').Configuration} */
const config = {
  '*.{js,ts,mjs,cjs,mts,cts}': ['prettier --write', 'eslint --fix'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
}

export default config
