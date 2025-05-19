// eslint-disable-next-line @typescript-eslint/no-require-imports
const prettierConfig = require('./.prettierrc.cjs');

// extension used when running `just lint` or `just lint.fix`
// includes unicorn, sonarjs and promise specific lints
// kept of of LSP as it's too slow
const extendedConfig = {
  root: true,
  env: {
    browser: true,
    es2024: true,
    node: true,
  },
  extends: [
    'plugin:promise/recommended',
    'plugin:sonarjs/recommended-legacy',
    'plugin:unicorn/recommended',
  ],
  plugins: ['sonarjs', 'unicorn', 'promise'],
  rules: {
    'unicorn/prefer-ternary': 'off',
    'unicorn/no-anonymous-default-export': 'off',
    'unicorn/no-empty-file': 'warn',
    'unicorn/prevent-abbreviations': 'off',
    'sonarjs/function-return-type': 'off',
    'sonarjs/unused-import': 'off',
    'sonarjs/deprecation': 'warn',
    'sonarjs/todo-tag': 'warn',
    'sonarjs/no-unused-vars': 'off',
    'sonarjs/redundant-type-aliases': 'off',
    'sonarjs/no-redundant-jump': 'off',
    'unicorn/no-null': 'off',
    'unicorn/no-useless-switch-case': 'off',
    'unicorn/no-array-for-each': 'off',
    'unicorn/no-array-reduce': 'warn',
    'sonarjs/different-types-comparison': 'warn',
    'sonarjs/no-commented-code': 'warn',
  },
};

let minimalConfig = {
  root: true,
  env: {
    browser: true,
    es2024: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:prettier/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ['@typescript-eslint', 'import'],
  rules: {
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        args: 'all',
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'prettier/prettier': [
      'error',
      prettierConfig,
      {
        prettierPath: require.resolve('prettier'),
      },
    ],
  },
  overrides: [
    {
      files: ['*.ts', '*.tsx'],
      rules: {
        // TypeScript-specific rules
        '@typescript-eslint/consistent-type-imports': 'warn',
      },
    },
  ],
};

const isObject = (o) => o && typeof o === 'object' && !Array.isArray(o);

function mergeDeep(target, source) {
  // Create a deep clone of the target to avoid modifying the original
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (isObject(source[key]) && isObject(target[key])) {
        // If both values are objects, merge them recursively
        result[key] = mergeDeep(target[key], source[key]);
      } else if (Array.isArray(source[key]) && Array.isArray(target[key])) {
        // If both values are arrays, concatenate them without duplicates
        result[key] = [...new Set([...target[key], ...source[key]])];
      } else {
        // Otherwise, use the value from the source
        result[key] = source[key];
      }
    }
  }

  return result;
}

if (process.env.ESLINT_MODE === 'full') {
  module.exports = mergeDeep(minimalConfig, extendedConfig);
} else {
  module.exports = minimalConfig;
}
