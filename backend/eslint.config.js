import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { codeStyleRules, testCodeStyleRules } from '../eslint.codeStyle.mjs'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,mjs}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
    rules: codeStyleRules,
  },
  { files: ['test/**/*.ts'], rules: testCodeStyleRules },
)
