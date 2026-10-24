import type { GitHubIdentity, IdentityResult } from '../../../shared/tools';
import type { FeatureContext } from '../../app/features';
import type { MainIpc } from '../../ipc/bridge';
import { createToolChecker, type ToolChecker } from './detect';
import { createIdentityReader, IdentityError } from './identity';
import { createProcessRunner } from './process-runner';

export interface ToolsService extends ToolChecker {
  identity(): Promise<GitHubIdentity>;
}

async function identityResult(service: ToolsService): Promise<IdentityResult> {
  try {
    return { ok: true, identity: await service.identity() };
  } catch (error) {
    if (error instanceof IdentityError) return { ok: false, reason: error.reason };
    throw error;
  }
}

export function registerTools(ipc: MainIpc, service: ToolsService): void {
  ipc.handle('tools:check', (options) => service.checkTools(options ?? {}));
  ipc.handle('tools:identity', () => identityResult(service));
}

export function register({ ipc }: FeatureContext): void {
  const runner = createProcessRunner();
  const { checkTools } = createToolChecker({ runner });
  const { identity } = createIdentityReader(runner);
  registerTools(ipc, { checkTools, identity });
}
