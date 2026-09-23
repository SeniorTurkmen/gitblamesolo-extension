import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  label: 'integrationTests',
  files: 'out/test/integration/**/*.test.js',
  mocha: {
    ui: 'bdd', // @vscode/test-cli defaults to 'tdd' (suite/test); our tests use describe/it.
    timeout: 20000,
  },
});
