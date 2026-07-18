import { describe, expect, it } from 'vitest';

import { createLoginSchema, createSetupSchema } from './authSchemas';

const translate = (key: string) => key;

describe('authentication schemas', () => {
  it('requires both login credentials', async () => {
    const schema = createLoginSchema(translate);

    await expect(schema.validate({ password: '', username: '' })).rejects.toMatchObject({
      message: 'usernameRequired',
    });
  });

  it('accepts the existing strong-password contract', async () => {
    const schema = createSetupSchema(translate);

    await expect(
      schema.validate({
        confirmPassword: 'StrongPass1',
        password: 'StrongPass1',
        username: 'astrbot',
      }),
    ).resolves.toMatchObject({ username: 'astrbot' });
  });

  it('rejects mismatched setup passwords', async () => {
    const schema = createSetupSchema(translate);

    await expect(
      schema.validate({
        confirmPassword: 'Different1',
        password: 'StrongPass1',
        username: 'astrbot',
      }),
    ).rejects.toMatchObject({ message: 'passwordMatch' });
  });
});
