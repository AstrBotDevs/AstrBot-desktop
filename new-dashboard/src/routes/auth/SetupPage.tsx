import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { authApi } from '@/api/auth';
import { requireAuthSession } from '@/auth/authFlow';
import { createSetupSchema } from '@/forms/authSchemas';
import { useAuthStore } from '@/stores/auth';
import { AuthShell } from './AuthShell';

type SetupValues = { confirmPassword: string; password: string; username: string };

export default function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const completeSession = useAuthStore((state) => state.completeSession);
  const hasToken = useAuthStore((state) => state.hasToken);
  const [apiError, setApiError] = useState('');
  const schema = useMemo(() => createSetupSchema((key) => t(`features/auth.setup.validation.${key}`)), [t]);
  const form = useForm<SetupValues>({
    defaultValues: { confirmPassword: '', password: '', username: 'astrbot' },
    resolver: yupResolver(schema),
  });

  useEffect(() => {
    void authApi.setupStatus().then((response) => {
      const status = response.data.data;
      if (!status?.setup_required || (!hasToken && !status.skip_default_password_auth)) {
        navigate('/auth/login', { replace: true });
      }
    }).catch(() => navigate('/auth/login', { replace: true }));
  }, [hasToken, navigate]);

  const submit = form.handleSubmit(async (values) => {
    setApiError('');
    try {
      const response = await authApi.setup({
        confirm_password: values.confirmPassword,
        password: values.password,
        username: values.username,
      });
      await completeSession(requireAuthSession(response), navigate);
    } catch (cause) {
      setApiError(cause instanceof Error ? cause.message : String(cause));
    }
  });

  return (
    <AuthShell subtitle={t('features/auth.setup.subtitle')} title={t('features/auth.setup.title')}>
      <form className="auth-form" onSubmit={submit}>
        <label>{t('features/auth.setup.username')}<input autoComplete="username" {...form.register('username')} /></label>
        {form.formState.errors.username && <p className="field-error">{form.formState.errors.username.message}</p>}
        <label>{t('features/auth.setup.password')}<input autoComplete="new-password" type="password" {...form.register('password')} /></label>
        {form.formState.errors.password && <p className="field-error">{form.formState.errors.password.message}</p>}
        <label>{t('features/auth.setup.confirmPassword')}<input autoComplete="new-password" type="password" {...form.register('confirmPassword')} /></label>
        {form.formState.errors.confirmPassword && <p className="field-error">{form.formState.errors.confirmPassword.message}</p>}
        <small>{t('features/auth.setup.passwordHint')}</small>
        <button className="button--primary auth-form__submit" disabled={form.formState.isSubmitting} type="submit">
          {form.formState.isSubmitting ? '…' : t('features/auth.setup.submit')}
        </button>
      </form>
      {apiError && <p className="auth-error" role="alert">{apiError}</p>}
    </AuthShell>
  );
}
