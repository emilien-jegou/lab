module.exports = {
  plugins: ['qwik'],
  extends: [
    './.eslintrc.base.cjs',
  ],
  parserOptions: {
    project: './tsconfig.json',
  },
  settings: {
    'import/resolver': {
      typescript: {
        project: './tsconfig.json',
        paths: {
          '@/*': ['./src/*']
        }
      }
    }
  }
};

