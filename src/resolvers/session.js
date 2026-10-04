import api, { route } from '@forge/api';

import { broadcast, EVENTS } from '../lib/events';
import { requireIssueInProject } from '../lib/issues';
import { cardsFor, DEFAULT_SCALE, isValidCard, isValidScale, scaleOptions } from '../lib/scales';
import {
    clearVotes,
    deleteSession,
    readDefaultDeck,
    readSession,
    readVotes,
    renewVotes,
    writeDefaultDeck,
    writeSession,
    writeVote,
} from '../lib/store';

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

// Works out which issue a request is about. The issue panel gets it from Jira's
// own context, which can be trusted as-is. The refinement page sends it in the
// payload, so it is checked against Jira (as the user) before anything happens.
export async function contextOf(req) {
    const extension = req.context?.extension;
    const accountId = req.context?.accountId;

    if (!accountId) {
        throw new Error('You need to be signed in to use Planning Poker.');
    }

    // projectId identifies the Jira space, which owns the default deck.
    const projectId = extension?.project?.id ? String(extension.project.id) : null;

    if (extension?.issue?.id) {
        return {
            issueId: String(extension.issue.id),
            issueKey: extension.issue.key,
            projectId,
            accountId,
            onPage: false,
        };
    }

    if (projectId) {
        if (!req.payload?.issueId) {
            throw new Error('Pick an issue to estimate.');
        }

        const issue = await requireIssueInProject(req.payload.issueId, projectId);
        return { ...issue, projectId, accountId, onPage: true };
    }

    throw new Error('Planning Poker must be opened from a Jira issue or project.');
}

async function currentUser() {
    const response = await api.asUser().requestJira(route`/rest/api/3/myself`);

    if (!response.ok) {
        return { name: 'Unknown user', avatar: null };
    }

    const { displayName, avatarUrls } = await response.json();
    return { name: displayName ?? 'Unknown user', avatar: avatarUrls?.['24x24'] ?? null };
}

async function buildState(issueId, accountId, projectId) {
    const session = await readSession(issueId);

    // The default deck only matters on the start screen, so it's only read then.
    if (!session) {
        const defaultScale = projectId ? await readDefaultDeck(projectId) : null;
        return {
            session: null,
            cards: [],
            votes: [],
            myVote: null,
            scales: scaleOptions(),
            defaultScale: isValidScale(defaultScale) ? defaultScale : null,
        };
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

// Flips the round to revealed and announces it. Shared by the Reveal button and by
// auto-reveal, which differ only in the checks they run beforehand.
async function revealRound({ issueId, accountId, onPage }, session, votes) {
    await writeSession(issueId, { ...session, revealed: true });
    await renewVotes(issueId, votes);

    // The one moment cards become public. An issue panel's audience is exactly
    // the people viewing that issue, so the cards ride along in the event. A
    // refinement page's audience is everyone on the project page, which may
    // include people barred from this issue (issue security), so there the event
    // only signals the reveal and each viewer fetches the cards through
    // getState, which checks their access first.
    await broadcast(EVENTS.REVEALED, {
        issueId,
        round: session.round,
        votes: onPage ? undefined : presentVotes(votes, true),
    });

    return buildState(issueId, accountId);
}

// Atlassian account ids are short strings of letters, digits, ':' and '-'.
// Anything else in an auto-reveal request is ignored rather than trusted.
const MAX_ROOM_SIZE = 100;
function accountIdsFrom(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((id) => typeof id === 'string' && /^[\w:-]{1,128}$/.test(id))
        .slice(0, MAX_ROOM_SIZE);
}

// Resolvers answer with a tagged result instead of throwing, because a thrown
// error reaches Custom UI as an opaque string the panel cannot act on.
export const handle = (fn) => async (req) => {
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
            const { issueId, issueKey, projectId, accountId } = await contextOf(req);
            return { issueKey, me: accountId, ...(await buildState(issueId, accountId, projectId)) };
        })
    );

    resolver.define(
        'startSession',
        handle(async (req) => {
            const { issueId, projectId, accountId } = await contextOf(req);
            const scale = isValidScale(req.payload?.scale) ? req.payload.scale : DEFAULT_SCALE;

            await clearVotes(issueId);

            // The deck picked here becomes the space's default for the next session.
            if (projectId) {
                await writeDefaultDeck(projectId, scale);
            }

            const session = {
                scale,
                revealed: false,
                round: 1,
                facilitator: accountId,
                startedAt: Date.now(),
            };
            await writeSession(issueId, session);

            await broadcast(EVENTS.STARTED, {
                issueId,
                round: session.round,
                scale,
                cards: cardsFor(scale),
            });

            return buildState(issueId, accountId);
        })
    );

    resolver.define(
        'castVote',
        handle(async (req) => {
            const { issueId, accountId } = await contextOf(req);
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
                issueId,
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
            const context = await contextOf(req);
            const session = await readSession(context.issueId);

            if (!session) {
                throw new Error('There is no session to reveal.');
            }

            const votes = await readVotes(context.issueId);

            if (votes.length === 0) {
                throw new Error('Nobody has voted yet.');
            }

            return revealRound(context, session, votes);
        })
    );

    // Sent by a browser that saw everyone in the room vote (see useAutoReveal).
    // Its view can be a moment out of date - a new round may have just started,
    // or the round may already be revealed - so the claim is re-checked against
    // storage, and if it no longer holds this quietly does nothing instead of
    // failing. It grants nothing the Reveal button doesn't already: anyone in a
    // session can reveal it.
    resolver.define(
        'autoReveal',
        handle(async (req) => {
            const context = await contextOf(req);
            const { issueId, accountId, projectId } = context;
            const expected = accountIdsFrom(req.payload?.accountIds);
            const session = await readSession(issueId);

            const stillOpen =
                session && !session.revealed && session.round === req.payload?.round;

            if (!stillOpen || expected.length === 0) {
                return buildState(issueId, accountId, projectId);
            }

            const votes = await readVotes(issueId);
            const voted = new Set(votes.map((vote) => vote.accountId));

            if (!expected.every((id) => voted.has(id))) {
                return buildState(issueId, accountId, projectId);
            }

            return revealRound(context, session, votes);
        })
    );

    resolver.define(
        'revote',
        handle(async (req) => {
            const { issueId, accountId } = await contextOf(req);
            const session = await readSession(issueId);

            if (!session) {
                throw new Error('There is no session to reset.');
            }

            await clearVotes(issueId);

            const next = { ...session, revealed: false, round: session.round + 1 };
            await writeSession(issueId, next);

            await broadcast(EVENTS.RESET, { issueId, round: next.round });

            return buildState(issueId, accountId);
        })
    );

    resolver.define(
        'endSession',
        handle(async (req) => {
            const { issueId, projectId, accountId } = await contextOf(req);

            await clearVotes(issueId);
            await deleteSession(issueId);
            await broadcast(EVENTS.ENDED, { issueId });

            return buildState(issueId, accountId, projectId);
        })
    );
}
