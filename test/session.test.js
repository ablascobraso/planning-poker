import { beforeEach, describe, expect, it } from 'vitest';
import { jira, respond } from '@forge/api';
import { kvs, kvsState } from '@forge/kvs';
import { realtimeState } from '@forge/realtime';

import { defineSessionResolvers } from '../src/resolvers/session';
import { fromPanel, ISSUE_ID, PROJECT_ID, resetForge, resolversFrom } from './helpers';

const resolvers = resolversFrom(defineSessionResolvers);

// Calls a session resolver as `accountId`, from the issue panel.
const as = (accountId, name, payload) => resolvers[name](fromPanel(accountId, payload));

const sessionInStorage = () => kvs.get(`pp:s:${ISSUE_ID}`);

// Every way a card value could appear in what was sent to browsers.
const containsCard = (value) => JSON.stringify(value).includes('"card"');

beforeEach(resetForge);

describe('vote privacy', () => {
    beforeEach(async () => {
        await as('alice', 'startSession', { scale: 'fibonacci' });
        await as('alice', 'castVote', { card: '5' });
        await as('bob', 'castVote', { card: '8' });
    });

    it('never sends anyone a card while the round is open', async () => {
        const forCarol = await as('carol', 'getState');
        const forAlice = await as('alice', 'getState');

        expect(forCarol.ok).toBe(true);
        expect(forCarol.votes.map((vote) => vote.accountId)).toEqual(['alice', 'bob']);
        expect(containsCard(forCarol.votes)).toBe(false);
        expect(forCarol.myVote).toBeNull();

        // Alice sees her own card, and nobody else's.
        expect(forAlice.myVote).toBe('5');
        expect(containsCard(forAlice.votes)).toBe(false);
    });

    it('announces that someone voted, never what they voted', () => {
        const voted = realtimeState.eventsOfType('voted');

        expect(voted).toHaveLength(2);
        expect(containsCard(voted)).toBe(false);
    });

    it('sends the cards with the reveal, and only then', async () => {
        const revealed = await as('carol', 'reveal');

        expect(revealed.ok).toBe(true);
        expect(revealed.votes.map(({ accountId, card }) => [accountId, card])).toEqual([
            ['alice', '5'],
            ['bob', '8'],
        ]);
        expect(realtimeState.eventsOfType('revealed')[0].payload.votes).toHaveLength(2);
    });

    it('turns away votes once the cards are revealed', async () => {
        await as('alice', 'reveal');
        const late = await as('carol', 'castVote', { card: '3' });

        expect(late.ok).toBe(false);
        expect(late.error).toMatch(/already revealed/);
    });

    it("rejects cards that aren't in the session's deck", async () => {
        const result = await as('carol', 'castVote', { card: 'XL' });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/not part of the current scale/);
    });
});

describe('led sessions', () => {
    beforeEach(async () => {
        await as('alice', 'startSession', { scale: 'fibonacci', led: true });
        await as('alice', 'castVote', { card: '5' });
    });

    it('only lets the facilitator reveal, start a new round, end or restart', async () => {
        for (const [action, payload] of [
            ['reveal'],
            ['revote'],
            ['endSession'],
            ['startSession', { scale: 'fibonacci' }],
        ]) {
            const result = await as('bob', action, payload);
            expect(result.ok, action).toBe(false);
            expect(result.error, action).toMatch(/is leading this session, so only they can/);
        }

        expect((await as('alice', 'reveal')).ok).toBe(true);
    });

    it('never auto-reveals: the facilitator decides', async () => {
        await as('bob', 'castVote', { card: '5' });
        await as('bob', 'autoReveal', { round: 1, accountIds: ['alice', 'bob'] });

        expect((await sessionInStorage()).revealed).toBe(false);
    });

    it('lets someone else take over, who then has the controls', async () => {
        const takeOver = await as('bob', 'takeOver');

        expect(takeOver.ok).toBe(true);
        expect(takeOver.session.facilitator).toBe('bob');
        expect(realtimeState.eventsOfType('lead')).toHaveLength(1);
        expect((await as('bob', 'reveal')).ok).toBe(true);
        expect((await as('alice', 'revote')).ok).toBe(false);
    });

    it('leaves sessions that are not led open to everyone', async () => {
        await as('alice', 'endSession');
        await as('alice', 'startSession', { scale: 'fibonacci', led: false });
        await as('alice', 'castVote', { card: '5' });

        expect((await as('bob', 'reveal')).ok).toBe(true);
    });
});

describe('auto-reveal re-checks the claim', () => {
    beforeEach(async () => {
        await as('alice', 'startSession', { scale: 'fibonacci' });
        await as('alice', 'castVote', { card: '5' });
    });

    it('does nothing while someone listed has not voted', async () => {
        const result = await as('bob', 'autoReveal', { round: 1, accountIds: ['alice', 'bob'] });

        expect(result.ok).toBe(true);
        expect(result.session.revealed).toBe(false);
        expect(realtimeState.eventsOfType('revealed')).toHaveLength(0);
    });

    it('does nothing for a round that is no longer the current one', async () => {
        await as('bob', 'castVote', { card: '8' });
        await as('alice', 'reveal');
        await as('alice', 'revote');
        await as('alice', 'castVote', { card: '5' });
        await as('bob', 'castVote', { card: '5' });

        await as('bob', 'autoReveal', { round: 1, accountIds: ['alice', 'bob'] });

        expect((await sessionInStorage()).revealed).toBe(false);
    });

    it('does nothing when nobody is listed', async () => {
        await as('bob', 'autoReveal', { round: 1, accountIds: [] });

        expect((await sessionInStorage()).revealed).toBe(false);
    });

    it('reveals once everyone listed has voted', async () => {
        await as('bob', 'castVote', { card: '8' });
        const result = await as('bob', 'autoReveal', { round: 1, accountIds: ['alice', 'bob'] });

        expect(result.session.revealed).toBe(true);
        expect(realtimeState.eventsOfType('revealed')).toHaveLength(1);
    });
});

describe('saving estimates', () => {
    const STORY_POINTS = { id: 'customfield_10016', name: 'Story point estimate' };
    const DEV_ESTIMATE = { id: 'customfield_10050', name: 'Development estimate' };

    // The space estimates two fields, and Jira accepts edits to the issue.
    beforeEach(async () => {
        await kvs.set(`pp:e:${PROJECT_ID}`, { fields: [DEV_ESTIMATE, STORY_POINTS], auto: false });
        jira.on('PUT', `/rest/api/3/issue/${ISSUE_ID}`, () => respond(204));
    });

    const playRound = async (scale, cards) => {
        await as('alice', 'startSession', { scale });
        for (const [voter, card] of Object.entries(cards)) {
            await as(voter, 'castVote', { card });
        }
    };

    const edits = () => jira.requestsTo('PUT', `/rest/api/3/issue/${ISSUE_ID}`);

    it('only saves after the reveal', async () => {
        await playRound('fibonacci', { alice: '5', bob: '5' });
        const result = await as('alice', 'saveEstimate', { value: '5' });

        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/Reveal the cards/);
        expect(edits()).toHaveLength(0);
    });

    it('writes the number to the field being estimated, and tells everyone', async () => {
        await playRound('fibonacci', { alice: '5', bob: '8' });
        await as('alice', 'reveal');
        const result = await as('bob', 'saveEstimate', { value: '8' });

        expect(result.ok).toBe(true);
        expect(edits()[0].body).toEqual({ fields: { [DEV_ESTIMATE.id]: 8 } });
        expect(result.session.saved).toMatchObject({ fieldId: DEV_ESTIMATE.id, card: '8', value: 8, round: 1 });
        expect(realtimeState.eventsOfType('saved')[0].payload.saved.value).toBe(8);
    });

    it('saves ½ as 0.5', async () => {
        await playRound('modifiedFibonacci', { alice: '½', bob: '½' });
        await as('alice', 'reveal');
        await as('alice', 'saveEstimate', { value: '½' });

        expect(edits()[0].body).toEqual({ fields: { [DEV_ESTIMATE.id]: 0.5 } });
    });

    it('only accepts number cards that were actually played', async () => {
        await playRound('fibonacci', { alice: '5', bob: '?' });
        await as('alice', 'reveal');

        for (const value of ['?', '8', '☕', 'not a card']) {
            const result = await as('alice', 'saveEstimate', { value });
            expect(result.ok, value).toBe(false);
            expect(result.error, value).toMatch(/number cards played this round/);
        }
        expect(edits()).toHaveLength(0);
    });

    it('in a led session, only lets the facilitator save', async () => {
        await as('alice', 'startSession', { scale: 'fibonacci', led: true });
        await as('alice', 'castVote', { card: '5' });
        await as('alice', 'reveal');

        const bob = await as('bob', 'saveEstimate', { value: '5' });
        expect(bob.ok).toBe(false);
        expect(bob.error).toMatch(/only they can save the estimate/);

        expect((await as('alice', 'saveEstimate', { value: '5' })).ok).toBe(true);
    });

    it("passes on Jira's refusal and doesn't record a save", async () => {
        jira.on('PUT', `/rest/api/3/issue/${ISSUE_ID}`, () =>
            respond(400, { errors: { [DEV_ESTIMATE.id]: 'Field cannot be set.' } })
        );
        await playRound('fibonacci', { alice: '5' });
        await as('alice', 'reveal');
        const result = await as('alice', 'saveEstimate', { value: '5' });

        expect(result.ok).toBe(false);
        expect(result.error).toBe("Jira didn't accept the estimate for Development estimate: Field cannot be set.");
        expect((await sessionInStorage()).saved).toBeNull();
    });

    it('explains a missing edit permission in plain words', async () => {
        jira.on('PUT', `/rest/api/3/issue/${ISSUE_ID}`, () => respond(403));
        await playRound('fibonacci', { alice: '5' });
        await as('alice', 'reveal');
        const result = await as('alice', 'saveEstimate', { value: '5' });

        expect(result.error).toMatch(/permission to edit this issue/);
    });

    it('moves on to the next field with a fresh session, and stays within the list', async () => {
        await playRound('fibonacci', { alice: '5' });
        const next = await as('alice', 'startSession', { scale: 'fibonacci', targetIndex: 1 });
        expect(next.session.targetIndex).toBe(1);
        expect(next.session.round).toBe(1);
        expect(next.votes).toEqual([]);

        const beyond = await as('alice', 'startSession', { scale: 'fibonacci', targetIndex: 5 });
        expect(beyond.session.targetIndex).toBe(0);
    });

    it('forgets the saved value when a new round starts', async () => {
        await playRound('fibonacci', { alice: '5' });
        await as('alice', 'reveal');
        await as('alice', 'saveEstimate', { value: '5' });
        const newRound = await as('alice', 'revote');

        expect(newRound.session.saved).toBeNull();
    });
});

describe('estimation fields found automatically', () => {
    it("uses the space's story points field when no admin has chosen any", async () => {
        jira.on('GET', `/rest/api/3/issue/${ISSUE_ID}/editmeta`, () =>
            respond(200, {
                fields: {
                    summary: { name: 'Summary', schema: { type: 'string', system: 'summary' } },
                    customfield_10016: {
                        name: 'Story point estimate',
                        schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points' },
                    },
                },
            })
        );

        const state = await as('alice', 'getState');

        expect(state.targets).toEqual([{ id: 'customfield_10016', name: 'Story point estimate' }]);
        // Remembered for the space, but re-checked after a week.
        expect(kvsState.optionsOf(`pp:e:${PROJECT_ID}`)).toEqual({ ttl: { unit: 'DAYS', value: 7 } });
    });
});

describe('session lifetime', () => {
    it('treats a session untouched for over 72 hours as ended', async () => {
        await kvs.set(`pp:s:${ISSUE_ID}`, {
            scale: 'fibonacci',
            revealed: false,
            round: 1,
            updatedAt: Date.now() - 73 * 60 * 60 * 1000,
        });

        const state = await as('alice', 'getState');

        expect(state.session).toBeNull();
    });

    it('stores sessions and votes with a 72-hour expiry', async () => {
        await as('alice', 'startSession', { scale: 'fibonacci' });
        await as('alice', 'castVote', { card: '5' });

        const expiry = { ttl: { unit: 'HOURS', value: 72 } };
        expect(kvsState.optionsOf(`pp:s:${ISSUE_ID}`)).toEqual(expiry);
        expect(kvsState.optionsOf(`pp:v:${ISSUE_ID}:alice`)).toEqual(expiry);
    });
});
