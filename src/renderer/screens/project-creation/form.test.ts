import { describe, expect, it } from 'vitest';
import { inviteProblem, matchingRepositories, repositoryToConnect, suggestedRepositoryName } from './form';

describe('the new-project form', () => {
  it.each([
    ['example-org/sample-repo-1', { owner: 'example-org', name: 'sample-repo-1' }],
    ['  example-org/sample.repo_2  ', { owner: 'example-org', name: 'sample.repo_2' }],
    ['example-org/sample-repo-1\nexample-org/other', null],
    ['[example-org/sample-repo-1]', null],
    ['example-org:sample-repo-1', null],
    ['example-org/sample-repo-1#3', null],
    ['example-org/sample=repo', null],
    ['example-org/sample-repo/extra', null],
    ['sample-repo-1', null],
    ['', null],
  ])('reads the repository to connect from %j', (typed, expected) => {
    expect(repositoryToConnect(typed)).toEqual(expected);
  });

  it.each([
    ['ben-example', null],
    ['  ben-example  ', null],
    ['Ada-Example', 'That is you'],
    ['carla-example', 'carla-example is on the list already'],
    ['ben-example\ncarla', 'is not a GitHub login'],
    ['@ben-example', 'is not a GitHub login'],
    ['ben:example', 'is not a GitHub login'],
    ['ben#1', 'is not a GitHub login'],
    ['ben=example', 'is not a GitHub login'],
    ['-ben', 'is not a GitHub login'],
    ['ben--example', 'is not a GitHub login'],
    ['b'.repeat(40), 'is not a GitHub login'],
  ])('checks the login %j before it goes on the invite list', (login, problem) => {
    const result = inviteProblem(login, ['Carla-Example'], 'ada-example');
    if (problem === null) expect(result).toBeNull();
    else expect(result).toContain(problem);
  });

  it('suggests a repository name from the project name', () => {
    expect(suggestedRepositoryName('  Sample project 1 ')).toBe('sample-project-1');
    expect(suggestedRepositoryName('Sample: project (2)!')).toBe('sample-project-2');
  });

  it.each([
    ['', ['example-org/team-code', 'example-org/team-docs', 'other-org/Handbook']],
    ['  ', ['example-org/team-code', 'example-org/team-docs', 'other-org/Handbook']],
    ['team', ['example-org/team-code', 'example-org/team-docs']],
    ['TEAM-DOCS', ['example-org/team-docs']],
    ['other-org/', ['other-org/Handbook']],
    [' handbook ', ['other-org/Handbook']],
    ['nothing-like-it', []],
  ])('searching the repositories for "%s" keeps the ones whose owner/name holds it, whatever the case', (search, expected) => {
    const repositories = ['example-org/team-code', 'example-org/team-docs', 'other-org/Handbook'].map((id) => {
      const [owner, name] = id.split('/');
      return { repository: { owner, name }, permission: 'write' as const };
    });

    expect(matchingRepositories(repositories, search).map(({ repository }) => `${repository.owner}/${repository.name}`)).toEqual(expected);
  });
});
