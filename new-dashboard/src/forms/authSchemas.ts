import * as yup from 'yup';

type Translate = (key: string) => string;

export function createLoginSchema(t: Translate) {
  return yup.object({
    password: yup.string().required(t('passwordRequired')),
    username: yup.string().required(t('usernameRequired')),
  });
}

export function createSetupSchema(t: Translate) {
  return yup.object({
    confirmPassword: yup.string()
      .required(t('confirmPasswordRequired'))
      .oneOf([yup.ref('password')], t('passwordMatch')),
    password: yup.string()
      .required(t('passwordRequired'))
      .min(8, t('passwordMinLength'))
      .matches(/[A-Z]/, t('passwordUppercase'))
      .matches(/[a-z]/, t('passwordLowercase'))
      .matches(/\d/, t('passwordDigit')),
    username: yup.string()
      .required(t('usernameRequired'))
      .min(3, t('usernameMinLength')),
  });
}
