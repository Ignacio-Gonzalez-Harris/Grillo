/**
 * Creating a project (PRD section 4.2 items 1-6), as the steps the Creating state lists: the repository (new or
 * connected) with Grillo's labels and folder, the member's own role and domains, the invites, the idea saved as
 * source S1 (and each attached document as a further source), then the grilling agent started in the project folder
 * with `/grillo-wayfinder <path to the idea's source file>` (resources/skills/README.md, Commands).
 *
 * A step that fails stops the run; running again starts at that step, so nothing already done is done twice. An
 * invite that GitHub refuses does not stop it: the step ends with a warning naming who was not invited and why, and the
 * idea and the grilling agent follow, since the member can invite them later.
 */
import type { Store } from '../../../main/store/store';
import type { Login, Member, PrdStructure, ProjectId, RepositoryRef, SourceKind } from '../../../main/store/types';
import { agentTitle, type AgentId } from '../../../shared/agents';
import type { GrilloApi } from '../../../shared/ipc';
import { StoreError } from '../../../shared/store';
import { saveLastMembership, type Membership } from './membership';
import { forgetUnstartedAgent, rememberUnstartedAgent, type UnstartedAgent } from './unstarted';

export const WAYFINDER_COMMAND = '/grillo-wayfinder';
/** Regenerates the PRD in the current structure (resources/skills/README.md, Commands). */
export const REGENERATE_COMMAND = '/grillo-prd regenerate';

/** The idea's source file, relative to the project folder with `/` between folders (docs/store-layout.md). */
export function sourcePath(code: string): string {
  return `.grillo/sources/${code}.md`;
}

export function wayfinderMessage(code: string): string {
  return `${WAYFINDER_COMMAND} ${sourcePath(code)}`;
}

export interface Attachment {
  name: string;
  text: string;
}

/** The idea as written text (`pasted-text`) or a recorded conversation's transcript (`meeting`). */
export interface Idea {
  kind: Extract<SourceKind, 'pasted-text' | 'meeting'>;
  text: string;
}

/** The two ways in (PRD section 4.2 item 1), as `createProject` takes them. */
export type RepositoryChoice = { newRepository: { organisation: Login; name: string } } | { connectRepository: RepositoryRef };

export interface ProjectDraft {
  repository: RepositoryChoice;
  /** The name the member gave the project: the grilling agent's tab is named after it. */
  projectName: string;
  structure: PrdStructure;
  invites: string[];
  membership: Membership;
  idea: Idea;
  /** Documents attached to a written idea; each becomes a source of its own. */
  attachments: Attachment[];
}

export interface CreationDeps {
  store: Store;
  grillo: GrilloApi;
  now?: () => Date;
}

export interface CreationStep {
  label: string;
  state: 'waiting' | 'running' | 'done' | 'failed';
  error: string | null;
  /** Set on a step that finished without doing all of its work: what was left undone and why. */
  warning: string | null;
}

/** What a step's work may hand back: a better label, and a warning when it finished without doing everything. */
type StepOutcome = void | string | { label: string; warning: string };

export interface Creation {
  steps: CreationStep[];
  /** Runs every step not yet done, in order; stops at the first that fails. */
  run(onChange: () => void): Promise<void>;
  project(): ProjectId | null;
  agent(): AgentId | null;
}

type CreationWork = { label: string; run: () => Promise<StepOutcome> };

const AGENT_STEP_LABEL = 'Grilling agent started; it is building the map and tickets';

/** Where the idea came from, as its source's `where:` line. */
export const IDEA_WHERE: Record<Idea['kind'], string> = {
  'pasted-text': 'the idea, given when the project was created',
  meeting: 'a transcript, given when the project was created',
};

const listed = (logins: readonly string[]): string =>
  logins.length <= 1 ? logins.join('') : `${logins.slice(0, -1).join(', ')} and ${logins.at(-1) ?? ''}`;

function repositoryLabel(input: RepositoryChoice): string {
  if ('newRepository' in input) {
    const { organisation, name } = input.newRepository;
    return `Private repository ${organisation}/${name} created, with Grillo's labels and folder`;
  }
  const { owner, name } = input.connectRepository;
  return `Repository ${owner}/${name} connected, with Grillo's labels and folder`;
}

function unreadable(what: string): never {
  throw new StoreError('backend', `Grillo could not read ${what} from the store.`);
}

const textOf = (value: unknown, what: string): string => (typeof value === 'string' && value !== '' ? value : unreadable(what));

function messageOf(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : String(error);
}

/**
 * Starts the grilling agent in the project folder. A refusal is kept in the settings file, wherever the member is by
 * then, so the start can be tried again later; not being able to keep it never hides the refusal itself.
 */
async function startGrillingAgent(deps: CreationDeps, request: Pick<UnstartedAgent, 'project' | 'firstMessage' | 'title'>): Promise<AgentId> {
  const { store, grillo } = deps;
  const { project, firstMessage, title } = request;
  try {
    const folder = textOf(await store.openProjectFolder(project), `the folder of ${project}`);
    const agent = await grillo.invoke('agents:start', { kind: 'grilling', folder, firstMessage, title });
    await forgetUnstartedAgent(grillo, project).catch(() => undefined);
    return agent;
  } catch (error) {
    const at = (deps.now ?? (() => new Date()))().toISOString();
    await rememberUnstartedAgent(grillo, { ...request, error: messageOf(error), at }).catch(() => undefined);
    throw error;
  }
}

export function startCreation(deps: CreationDeps, draft: ProjectDraft): Creation {
  const { store, grillo } = deps;
  const now = deps.now ?? (() => new Date());
  let project: ProjectId | null = null;
  let me: Member | null = null;
  let agentId: AgentId | null = null;
  const ideaCodes: string[] = [];
  const invited = new Set<string>();
  const savedDocuments: string[] = [];

  const inProject = (): ProjectId => project ?? unreadable('the new project');
  const who = (): string => (me === null ? '' : (me.name ?? me.login));

  const work: CreationWork[] = [
    {
      label: repositoryLabel(draft.repository),
      async run() {
        const created: unknown = await store.createProject({ ...draft.repository, structure: draft.structure });
        project = textOf((created as { id?: unknown } | null)?.id, 'the new project');
      },
    },
    {
      label: 'Your role and domains saved',
      async run() {
        const id = inProject();
        const member: unknown = await store.currentMember(id);
        me = { ...(member as Member), login: textOf((member as { login?: unknown } | null)?.login, 'who you are') };
        await store.updateMember(id, me.login, { role: draft.membership.role, domains: [...draft.membership.domains] });
        await saveLastMembership(grillo, { project: id, ...draft.membership });
      },
    },
  ];
  if (draft.invites.length > 0) {
    work.push({
      label: `Invites sent to ${listed(draft.invites)}`,
      async run() {
        const refused: string[] = [];
        for (const login of draft.invites.filter((entry) => !invited.has(entry))) {
          try {
            await store.addMember(inProject(), { login, role: '', domains: [] });
            invited.add(login);
          } catch (error) {
            refused.push(`${login}: ${messageOf(error)}`);
          }
        }
        if (refused.length === 0) return;
        const sent = draft.invites.filter((login) => invited.has(login));
        return {
          label: sent.length === 0 ? 'No invite sent' : `Invites sent to ${listed(sent)}`,
          warning: `Not invited (invite them later from the project): ${refused.join('; ')}.`,
        };
      },
    });
  }
  work.push({
    label: 'The idea saved as source S1',
    async run() {
      if (ideaCodes.length === 0) {
        const source = await store.createSource(inProject(), {
          kind: draft.idea.kind,
          who: who(),
          when: now().toISOString(),
          where: IDEA_WHERE[draft.idea.kind],
          text: draft.idea.text,
        });
        ideaCodes.push(textOf((source as { code?: unknown } | null)?.code, 'the idea\'s source code'));
      }
      return `The idea saved as source ${ideaCodes[0]}`;
    },
  });
  if (draft.attachments.length > 0) {
    work.push({
      label: `${draft.attachments.length === 1 ? 'The attached document' : 'The attached documents'} saved as sources`,
      async run() {
        for (const attachment of draft.attachments.slice(savedDocuments.length)) {
          const source = await store.createSource(inProject(), {
            kind: 'document',
            who: who(),
            when: now().toISOString(),
            where: attachment.name,
            text: attachment.text,
          });
          savedDocuments.push(textOf((source as { code?: unknown } | null)?.code, 'a document\'s source code'));
        }
        return `${savedDocuments.length === 1 ? 'The attached document' : 'The attached documents'} saved as ${savedDocuments.length === 1 ? 'source' : 'sources'} ${listed(savedDocuments)}`;
      },
    });
  }
  work.push({
    label: AGENT_STEP_LABEL,
    async run() {
      const id = inProject();
      agentId = await startGrillingAgent(deps, {
        project: id,
        firstMessage: wayfinderMessage(ideaCodes[0] ?? unreadable('the idea\'s source code')),
        title: agentTitle('grilling', draft.projectName.trim() === '' ? id : draft.projectName.trim()),
      });
    },
  });

  const steps: CreationStep[] = work.map(({ label }) => ({ label, state: 'waiting', error: null, warning: null }));
  return runnerOf(work, steps, () => project, () => agentId);
}

/** The Creating state of a project whose grilling agent was refused earlier: that one step, failed, to run again. */
export function resumeCreation(deps: CreationDeps, unstarted: UnstartedAgent): Creation {
  const { project, firstMessage, title, error } = unstarted;
  let agentId: AgentId | null = null;
  const work: CreationWork[] = [
    {
      label: AGENT_STEP_LABEL,
      async run() {
        agentId = await startGrillingAgent(deps, { project, firstMessage, title });
      },
    },
  ];
  return runnerOf(work, [{ label: AGENT_STEP_LABEL, state: 'failed', error, warning: null }], () => project, () => agentId);
}

function runnerOf(work: CreationWork[], steps: CreationStep[], project: () => ProjectId | null, agent: () => AgentId | null): Creation {
  let running = false;

  return {
    steps,
    async run(onChange) {
      if (running) return;
      running = true;
      try {
        for (const [index, step] of steps.entries()) {
          if (step.state === 'done') continue;
          step.state = 'running';
          step.error = null;
          onChange();
          try {
            const outcome = await work[index].run();
            if (typeof outcome === 'string') step.label = outcome;
            else if (outcome) {
              step.label = outcome.label;
              step.warning = outcome.warning;
            }
            step.state = 'done';
            onChange();
          } catch (error) {
            step.state = 'failed';
            step.error = messageOf(error);
            onChange();
            return;
          }
        }
      } finally {
        running = false;
      }
    },
    project,
    agent,
  };
}
