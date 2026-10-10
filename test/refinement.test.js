import { beforeEach, describe, expect, it } from 'vitest';
import { jira, respond } from '@forge/api';
import { kvs } from '@forge/kvs';

import { defineRefinementResolvers } from '../src/resolvers/refinement';
import { fromSpacePage, PROJECT_ID, resetForge, resolversFrom } from './helpers';

const resolvers = resolversFrom(defineRefinementResolvers);
const as = (accountId, name, payload) => resolvers[name](fromSpacePage(accountId, payload));

const CURRENT = '20001';
const OTHER = '20002';

beforeEach(async () => {
    resetForge();

    // Every issue exists, belongs to the space and is visible to everyone.
    jira.on('GET', /^\/rest\/api\/3\/issue\/\d+\?fields=project/, ({ path }) => {
        const id = path.match(/issue\/(\d+)/)[1];
        return respond(200, { id, key: `PPT-${id}`, fields: { project: { id: PROJECT_ID } } });
    });

    await kvs.set(`pp:q:${PROJECT_ID}`, { issueIds: [CURRENT, OTHER] });
    await kvs.set(`pp:f:${PROJECT_ID}`, { issueId: CURRENT, updatedAt: Date.now() });
});

const leadCurrentIssue = (led) =>
    kvs.set(`pp:s:${CURRENT}`, {
        scale: 'fibonacci',
        revealed: false,
        round: 1,
        led,
        facilitator: 'alice',
        facilitatorName: 'Alice',
        updatedAt: Date.now(),
    });

describe('switching issues on the refinement page', () => {
    it("is only for the facilitator while the current issue's session is led", async () => {
        await leadCurrentIssue(true);

        const bob = await as('bob', 'setFocus', { issueId: OTHER });
        expect(bob.ok).toBe(false);
        expect(bob.error).toBe('Alice is leading this session, so only they can move everyone to another issue.');
        expect((await kvs.get(`pp:f:${PROJECT_ID}`)).issueId).toBe(CURRENT);

        const alice = await as('alice', 'setFocus', { issueId: OTHER });
        expect(alice.ok).toBe(true);
        expect((await kvs.get(`pp:f:${PROJECT_ID}`)).issueId).toBe(OTHER);
    });

    it('is open to everyone when the session is not led', async () => {
        await leadCurrentIssue(false);

        expect((await as('bob', 'setFocus', { issueId: OTHER })).ok).toBe(true);
    });

    it('is open to everyone once the led issue has left the queue', async () => {
        await leadCurrentIssue(true);
        await kvs.set(`pp:q:${PROJECT_ID}`, { issueIds: [OTHER] });

        expect((await as('bob', 'setFocus', { issueId: OTHER })).ok).toBe(true);
    });

    it("refuses issues from another space", async () => {
        jira.on('GET', `/rest/api/3/issue/30003?fields=project`, () =>
            respond(200, { id: '30003', key: 'ABC-3', fields: { project: { id: '99999' } } })
        );

        const result = await as('bob', 'setFocus', { issueId: '30003' });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not part of this project/);
    });
});
