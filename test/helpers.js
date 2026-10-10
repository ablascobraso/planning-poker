import { vi } from 'vitest';
import { jira } from '@forge/api';
import { kvsState } from '@forge/kvs';
import { realtimeState } from '@forge/realtime';

export const PROJECT_ID = '10000';
export const ISSUE_ID = '10001';

// Collects the resolver functions a define*Resolvers(resolver) call registers,
// so tests can call them by name - the way Forge does when a browser invokes.
export function resolversFrom(...defineAll) {
    const handlers = {};
    const resolver = { define: (name, fn) => (handlers[name] = fn) };
    defineAll.forEach((define) => define(resolver));
    return handlers;
}

// A fresh, empty Forge for every test. Resolver errors are expected in many
// tests (that's what they check), so their console noise is silenced.
export function resetForge() {
    kvsState.reset();
    realtimeState.reset();
    jira.reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
}

// What Forge passes a resolver when someone acts from the issue panel of
// ISSUE_ID - the issue comes from Jira's own context.
export const fromPanel = (accountId, payload = {}) => ({
    context: {
        accountId,
        extension: {
            type: 'jira:issuePanel',
            issue: { id: ISSUE_ID, key: 'PPT-1' },
            project: { id: PROJECT_ID, key: 'PPT' },
        },
    },
    payload,
});

// What Forge passes from the refinement page or the space settings page: only
// the space is in the context; the page names its issue in the payload.
export const fromSpacePage = (accountId, payload = {}, type = 'jira:projectPage') => ({
    context: {
        accountId,
        extension: { type, project: { id: PROJECT_ID, key: 'PPT' } },
    },
    payload,
});
