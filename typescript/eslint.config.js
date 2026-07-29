// ESLint flat config. There was no config file at all before, so `npm run lint`
// always exited with "No files matching the pattern" — the script existed but
// had never linted anything.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Unused variables are already caught by tsc (noUnusedLocals), but keep
      // the lint rule so it is reported with the rest of the lint output.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  }
);
