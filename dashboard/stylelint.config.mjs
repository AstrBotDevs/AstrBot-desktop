export default {
  customSyntax: 'postcss-scss',
  ignoreFiles: ['coverage/**', 'dist/**', 'node_modules/**'],
  plugins: ['stylelint-scss'],
  rules: {
    'at-rule-no-unknown': null,
    'block-no-empty': true,
    'color-no-invalid-hex': true,
    'declaration-block-no-duplicate-custom-properties': true,
    'declaration-block-no-duplicate-properties': [
      true,
      {
        ignore: ['consecutive-duplicates-with-different-values'],
      },
    ],
    'function-calc-no-unspaced-operator': true,
    'no-duplicate-at-import-rules': true,
    'no-duplicate-selectors': true,
    'property-no-unknown': true,
    'scss/at-rule-no-unknown': true,
    'scss/no-duplicate-dollar-variables': true,
    'scss/no-duplicate-mixins': true,
    'scss/operator-no-unspaced': true,
    'selector-max-id': 1,
    'selector-max-specificity': [
      '1,10,1',
    ],
    'selector-pseudo-class-no-unknown': true,
    'selector-pseudo-element-no-unknown': true,
    'unit-no-unknown': true,
  },
};
