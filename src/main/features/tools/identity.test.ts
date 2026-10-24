import { describe, expect, it } from 'vitest';
import { createFakeRunner, exited, type FakeAnswers, NOT_FOUND } from './fake-runner';
import { createIdentityReader, IdentityError } from './identity';

const USER = JSON.stringify({ login: 'ada-example', name: 'Ada Example', email: 'ada@example.test', id: 1 });
const USER_WITHOUT_EMAIL = JSON.stringify({ login: 'ada-example', name: 'Ada Example', email: null });

function identityFrom(answers: FakeAnswers) {
  return createIdentityReader(createFakeRunner(answers)).identity();
}

async function failureOf(answers: FakeAnswers): Promise<unknown> {
  return identityFrom(answers).then(
    () => 'resolved',
    (error: unknown) => error,
  );
}

describe('identity', () => {
  it('returns the login, name and email GitHub gives for the signed-in member', async () => {
    await expect(identityFrom({ 'gh api user': exited(0, USER) })).resolves.toEqual({
      login: 'ada-example',
      name: 'Ada Example',
      email: 'ada@example.test',
    });
  });

  it('falls back to the primary address from user/emails when the profile has no public email', async () => {
    const emails = JSON.stringify([
      { email: 'old@example.test', primary: false, verified: true },
      { email: 'ada@example.test', primary: true, verified: true },
    ]);

    await expect(
      identityFrom({ 'gh api user': exited(0, USER_WITHOUT_EMAIL), 'gh api user/emails': exited(0, emails) }),
    ).resolves.toEqual({ login: 'ada-example', name: 'Ada Example', email: 'ada@example.test' });
  });

  it('leaves the email null when user/emails is refused or its answer has no usable primary address', async () => {
    const answers = [
      exited(1, '', 'gh: Not Found (HTTP 404)\n'),
      exited(0, 'not json'),
      exited(0, 'null'),
      exited(0, '{}'),
      exited(0, '[null, 3, "x"]'),
      exited(0, JSON.stringify([{ email: 'old@example.test', primary: false }])),
      exited(0, JSON.stringify([{ email: null, primary: true }])),
    ];

    for (const emailsAnswer of answers) {
      const identity = await identityFrom({
        'gh api user': exited(0, USER_WITHOUT_EMAIL),
        'gh api user/emails': emailsAnswer,
      });
      expect(identity.email, JSON.stringify(emailsAnswer)).toBeNull();
    }
  });

  it('takes the first usable primary address when the list carries duplicates or junk', async () => {
    const emails = JSON.stringify([
      null,
      { email: 42, primary: true },
      { email: 'ada@example.test', primary: true },
      { email: 'ada@example.test', primary: true },
      { email: 'other@example.test', primary: true },
    ]);

    const identity = await identityFrom({
      'gh api user': exited(0, USER_WITHOUT_EMAIL),
      'gh api user/emails': exited(0, emails),
    });

    expect(identity.email).toBe('ada@example.test');
  });

  it('turns a missing or non-text name into null', async () => {
    for (const name of [null, undefined, 7]) {
      const user = JSON.stringify({ login: 'ada-example', name, email: 'ada@example.test' });
      const identity = await identityFrom({ 'gh api user': exited(0, user) });
      expect(identity.name).toBeNull();
    }
  });

  it('throws a typed signed-out error when gh asks for sign-in or GitHub refuses the stored sign-in', async () => {
    const signedOut = [
      exited(4, '', 'To get started with GitHub CLI, please run:  gh auth login\n'),
      exited(1, '', 'gh: Bad credentials (HTTP 401)\n'),
    ];

    for (const answer of signedOut) {
      const error = await failureOf({ 'gh api user': answer });
      expect(error).toBeInstanceOf(IdentityError);
      expect((error as IdentityError).reason).toBe('signed-out');
    }
  });

  it('throws a typed not-installed error when gh is missing', async () => {
    const error = await failureOf({ 'gh api user': NOT_FOUND });
    expect(error).toBeInstanceOf(IdentityError);
    expect((error as IdentityError).reason).toBe('not-installed');
  });

  it('throws a typed failed error for any other failure or an answer without a login', async () => {
    const failures = [
      exited(1, '', 'error connecting to api.github.com\n'),
      { found: true as const, exitCode: null, stdout: '', stderr: '' },
      exited(0, ''),
      exited(0, 'not json'),
      exited(0, 'null'),
      exited(0, '[]'),
      exited(0, JSON.stringify({ name: 'Ada Example' })),
      exited(0, JSON.stringify({ login: 12 })),
      exited(0, JSON.stringify({ login: '' })),
    ];

    for (const answer of failures) {
      const error = await failureOf({ 'gh api user': answer });
      expect(error, JSON.stringify(answer)).toBeInstanceOf(IdentityError);
      expect((error as IdentityError).reason).toBe('failed');
    }
  });
});
