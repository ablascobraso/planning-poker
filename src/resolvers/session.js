import api, { route } from '@forge/api';

import { broadcast, EVENTS } from '../lib/events';
import { cardsFor, DEFAULT_SCALE, isValidCard, isValidScale, scaleOptions } from '../lib/scales';
import { clearVotes, readSession, readVotes, writeSession, writeVote, deleteSession } from '../lib/store';
import { saveStoryPoints } from '../lib/storyPoints';

// THE PRIVACY BOUNDARY. While a round is open the server knows every card but
// must never let one leave: clients learn only *that* somebody voted. Doing this
// here rather than in the UI means a crafted invoke() cannot read early votes.
function presentVotes(votes, revealed) {
    return votes
        .map(({ accountId, name, avatar, card, votedAt }) =>
            revealed
                ? { accountId, name, avatar, card, votedAt }
                : { accountId, name, avatar, votedAt }
        )
        .sort((a, b) => a.votedAt - b.votedAt);
}

function contextOf(req) {
    const issue = req.context?.extension?.issue;
    const accountId = req.context?.accountId;

    if (!issue?.id || !accountId) {
        throw new Error('This panel must be opened from a Jira issue.');
    }

    return { issueId: String(issue.id), issueKey: issue.key, accountId };
}

async function currentUser() {
    const response = await api.asUser().requestJira(route`/rest/api/3/myself`);

    if (!response.ok) {
        return { name: 'Unknown user', avatar: null };
    }

    const { displayName, avatarUrls } = await response.json();
    return { name: displayName ?? 'Unknown user', avatar: avatarUrls?.['24x24'] ?? null };
}

async function buildState(issueId, accountId) {
    const session = await readSession(issueId);

    if (!session) {
        return { session: null, cards: [], votes: [], myVote: null, scales: scaleOptions() };
    }

    const votes = await readVotes(issueId);

    return {
        session: {
            scale: session.scale,
            revealed: session.revealed,
            round: session.round,
            facilitator: session.facilitator,
            startedAt: session.startedAt,
        },
        cards: cardsFor(session.scale),
        scales: scaleOptions(),
        votes: presentVotes(votes, session.revealed),
        myVote: votes.find((vote) => vote.accountId === accountId)?.card ?? null,
    };
}

// Resolvers answer with a tagged result instead of throwing, because a thrown
// error reaches Custom UI as an opaque string the panel cannot act on.
const handle = (fn) => async (req) => {
    try {
        return { ok: true, ...(await fn(req)) };
    } catch (error) {
        console.error('resolver failed', error);
        return { ok: false, error: error.message ?? 'Something went wrong.' };
    }
};

export function defineSessionResolvers(resolver) {
    resolver.define(
        'getState',
        handle(async (req) => {
            const { issueId, issueKey, accountId } = contextOf(req);
            return { issueKey, me: accountId, ...(await buildState(issueId, accountId)) };
        })
    );

    resolver.define(
        'startSession',
        handle(async (req) => {
            const { issueId, accountId } = contextOf(req);
            const scale = isValidScale(req.payload?.scale) ? req.payload.scale : DEFAULT_SCALE;

            await clearVotes(issueId);

            const session = {
                scale,
                revealed: false,
                round: 1,
                facilitator: accountId,
                startedAt: Date.now(),
            };
            await writeSession(issueId, session);

            await broadcast(EVENTS.STARTED, { round: session.round, scale, cards: cardsFor(scale) });

            return buildState(issueId, accountId);
        })
    );

    resolver.define(
        'castVote',
        handle(async (req) => {
            const { issueId, accountId } = contextOf(req);
            const session = await readSession(issueId);

            if (!session) {
                throw new Error('This session has ended. Start a new round to vote.');
            }

            if (session.revealed) {
                throw new Error('Votes are already revealed. Start a new round to change yours.');
            }

            const card = req.payload?.card;

            if (!isValidCard(session.scale, card)) {
                throw new Error('That card is not part of the current scale.');
            }

            const { name, avatar } = await currentUser();
            await writeVote(issueId, accountId, { card, name, avatar, votedAt: Date.now() });

            // Deliberately omits the card - see presentVotes.
            await broadcast(EVENTS.VOTED, {
                round: session.round,
                voter: { accountId, name, avatar, votedAt: Date.now() },
            });

            // Returns the whole state rather than just the card so the voter sees
            // themselves in the list without depending on the realtime broadcast
            // being echoed back to its own publisher.
            return buildState(issueId, accountId);
        })
    );

    resolver.define(
        'reveal',
        handle(async (req) => {
            const { issueId, accountId } = contextOf(req);
            const session = await readSession(issueId);

            if (!session) {
                throw new Error('There is no session to reveal.');
            }

            const votes = await readVotes(issueId);

            if (votes.length === 0) {
                throw new Error('Nobody has voted yet.');
            }

            await writeSession(issueId, { ...session, revealed: true });

            // The one moment cards become public. Sending them in the event saves
            // every open panel a resolver round-trip just to learn the result.
            await broadcast(EVENTS.REVEALED, {
                round: session.round,
                votes: presentVotes(votes, true),
            });

            return buildState(issueId, accountId);
        })
    );

    resolver.define(
        'revote',
        handle(async (req) => {
            const { issueId, accountId } = contextOf(req);
            const session = await readSession(issueId);

            if (!session) {
                throw new Error('There is no session to reset.');
            }

            await clearVotes(issueId);

            const next = { ...session, revealed: false, round: session.round + 1 };
            await writeSession(issueId, next);

            await broadcast(EVENTS.RESET, { round: next.round });

            return buildState(issueId, accountId);
        })
    );

    resolver.define(
        'endSession',
        handle(async (req) => {
            const { issueId } = contextOf(req);

            await clearVotes(issueId);
            await deleteSession(issueId);
            await broadcast(EVENTS.ENDED, {});

            return { session: null, cards: [], votes: [], myVote: null, scales: scaleOptions() };
        })
    );

    resolver.define(
        'saveEstimate',
        handle(async (req) => {
            const { issueId } = contextOf(req);
            const value = Number(req.payload?.value);

            if (!Number.isFinite(value) || value < 0) {
                throw new Error('Story points must be a non-negative number.');
            }

            await saveStoryPoints(issueId, value);
            await broadcast(EVENTS.SAVED, { estimate: value });

            return { estimate: value };
        })
    );
}
