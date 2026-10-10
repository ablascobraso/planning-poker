import api, { route } from '@forge/api';

import { estimationTargets, saveFieldValue } from '../lib/estimation';
import { broadcastToIssue, EVENTS, sessionToken } from '../lib/events';
import { requireIssueInProject } from '../lib/issues';
import {
    cardNumber,
    cardsFor,
    DEFAULT_SCALE,
    isValidCard,
    isValidScale,
    scaleOptions,
} from '../lib/scales';
import {
    clearVotes,
    deleteSession,
    readSession,
    readSpaceDefaults,
    readVotes,
    renewVotes,
    writeSession,
    writeSpaceDefaults,
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

// ROUND HISTORY. When a round is revealed, its cards are recorded on the session
// so the team can see how estimates moved between rounds ("Round 1: 3, 5, 8 ->
// Round 2: 5, 5, 5"). Only revealed rounds are recorded, so this never exposes
// a card before its reveal. It lives inside the session record - no extra
// storage reads or writes - and so it expires with the session and is cleared
// by End or by starting a new session.
const MAX_HISTORY = 20;

function historyEntry(round, votes) {
    return {
        round,
        votes: [...votes]
            .sort((a, b) => a.votedAt - b.votedAt)
            .map(({ accountId, name, card }) => ({ accountId, name, card })),
    };
}

// Adds (or, if the round is revealed twice, replaces) a round's entry.
function withRound(history, entry) {
    return [...(history ?? []).filter((past) => past.round !== entry.round), entry]
        .sort((a, b) => a.round - b.round)
        .slice(-MAX_HISTORY);
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
        };
    }

    if (projectId) {
        if (!req.payload?.issueId) {
            throw new Error('Pick an issue to estimate.');
        }

        const issue = await requireIssueInProject(req.payload.issueId, projectId);
        return { ...issue, projectId, accountId };
    }

    throw new Error('Planning Poker must be opened from a Jira issue or project.');
}

// FACILITATOR CONTROLS. A session can be "led": then only its facilitator -
// whoever started it, or whoever later took over - may reveal, start a new
// round, restart or end it, and auto-reveal is off because the facilitator
// decides when. Sessions that aren't led stay open to everyone, as before.
//
// This guards against accidental clicks in bigger meetings; it is not a
// security permission. Jira still decides who can see the issue, and anyone in
// the session can take over (see takeOver) if the facilitator has gone.
export function mayLead(session, accountId) {
    return !session?.led || session.facilitator === accountId;
}

// Enforced here rather than only by hiding buttons, so a tab that missed an
// update (or a crafted invoke) can't act on a led session either.
export function requireLead(session, accountId, action) {
    if (!mayLead(session, accountId)) {
        const name = session.facilitatorName ?? 'The facilitator';
        throw new Error(`${name} is leading this session, so only they can ${action}.`);
    }
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

    // The space's defaults only matter on the start screen, so they're only read then.
    if (!session) {
        const defaults = projectId
            ? await readSpaceDefaults(projectId)
            : { scale: null, led: false };
        return {
            session: null,
            cards: [],
            votes: [],
            myVote: null,
            scales: scaleOptions(),
            history: [],
            defaultScale: isValidScale(defaults.scale) ? defaults.scale : null,
            defaultLed: defaults.led,
            // The fields a new session would save its estimates to (see estimation.js).
            targets: await estimationTargets(projectId, issueId),
        };
    }

    const votes = await readVotes(issueId);

    return {
        session: {
            scale: session.scale,
            revealed: session.revealed,
            round: session.round,
            // Sessions saved before facilitator controls existed read as not led.
            led: session.led === true,
            facilitator: session.facilitator,
            facilitatorName: session.facilitatorName ?? null,
            startedAt: session.startedAt,
            // Saving estimates: the space's fields when the session started, the
            // one this session estimates, and what has been saved to it this
            // round. Older sessions have none, and simply don't offer saving.
            targets: session.targets ?? [],
            targetIndex: session.targetIndex ?? 0,
            saved: session.saved ?? null,
        },
        cards: cardsFor(session.scale),
        scales: scaleOptions(),
        // Sessions saved before round history existed simply have none.
        history: session.history ?? [],
        votes: presentVotes(votes, session.revealed),
        myVote: votes.find((vote) => vote.accountId === accountId)?.card ?? null,
    };
}

// Flips the round to revealed and announces it. Shared by the Reveal button and by
// auto-reveal, which differ only in the checks they run beforehand.
async function revealRound({ issueId, accountId }, session, votes) {
    const entry = historyEntry(session.round, votes);
    await writeSession(issueId, {
        ...session,
        revealed: true,
        history: withRound(session.history, entry),
    });
    await renewVotes(issueId, votes);

    // The one moment cards become public. They ride along in the event because
    // only people who passed the access check for this issue hold a token to
    // hear it (see events.js), in the issue panel and the refinement page alike.
    await broadcastToIssue(issueId, EVENTS.REVEALED, {
        round: session.round,
        votes: presentVotes(votes, true),
        historyEntry: entry,
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

            // The browser asks for a live-update token only when it needs one (on
            // first load, or when its token is about to expire): signing counts
            // toward Forge's realtime rate limit. The access check above has
            // already passed, so it may listen to this issue's events.
            const withToken = req.payload?.withToken === true;
            const [state, live] = await Promise.all([
                buildState(issueId, accountId, projectId),
                withToken ? sessionToken(issueId) : null,
            ]);

            return { issueId, issueKey, me: accountId, ...state, ...(withToken ? { live } : {}) };
        })
    );

    resolver.define(
        'startSession',
        handle(async (req) => {
            const { issueId, projectId, accountId } = await contextOf(req);
            const scale = isValidScale(req.payload?.scale) ? req.payload.scale : DEFAULT_SCALE;
            const led = req.payload?.led === true;

            // The fields this session can save to. "Next: QA estimate" starts the
            // following session on the same issue with the next targetIndex.
            const targets = await estimationTargets(projectId, issueId);
            const requestedIndex = Number(req.payload?.targetIndex ?? 0);
            const targetIndex =
                Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < targets.length
                    ? requestedIndex
                    : 0;

            // Starting replaces whatever session is there, so a led one can only
            // be restarted by its facilitator. Start is hidden while a session
            // runs, but a tab that missed the "started" update could still show it.
            requireLead(await readSession(issueId), accountId, 'restart it');

            await clearVotes(issueId);

            // The deck and the leading choice become the space's defaults.
            if (projectId) {
                await writeSpaceDefaults(projectId, { scale, led });
            }

            // A led session shows everyone who leads it, so it keeps their name.
            const facilitatorName = led ? (await currentUser()).name : null;

            const session = {
                scale,
                revealed: false,
                round: 1,
                led,
                facilitator: accountId,
                facilitatorName,
                startedAt: Date.now(),
                // A new session starts a new history.
                history: [],
                targets,
                targetIndex,
                saved: null,
            };
            await writeSession(issueId, session);

            await broadcastToIssue(issueId, EVENTS.STARTED, {
                round: session.round,
                scale,
                cards: cardsFor(scale),
                led,
                facilitator: accountId,
                facilitatorName,
                targets,
                targetIndex,
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
            await broadcastToIssue(issueId, EVENTS.VOTED, {
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

            requireLead(session, context.accountId, 'reveal the cards');

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
    // session that isn't led can reveal it. Led sessions never auto-reveal -
    // their facilitator decides when.
    resolver.define(
        'autoReveal',
        handle(async (req) => {
            const context = await contextOf(req);
            const { issueId, accountId, projectId } = context;
            const expected = accountIdsFrom(req.payload?.accountIds);
            const session = await readSession(issueId);

            const stillOpen =
                session &&
                !session.led &&
                !session.revealed &&
                session.round === req.payload?.round;

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

            requireLead(session, accountId, 'start a new round');

            await clearVotes(issueId);

            const next = { ...session, revealed: false, round: session.round + 1, saved: null };
            await writeSession(issueId, next);

            await broadcastToIssue(issueId, EVENTS.RESET, { round: next.round });

            return buildState(issueId, accountId);
        })
    );

    resolver.define(
        'endSession',
        handle(async (req) => {
            const { issueId, projectId, accountId } = await contextOf(req);

            requireLead(await readSession(issueId), accountId, 'end it');

            await clearVotes(issueId);
            await deleteSession(issueId);
            await broadcastToIssue(issueId, EVENTS.ENDED);

            return buildState(issueId, accountId, projectId);
        })
    );

    // Saves the revealed round's agreed value to the session's estimation field
    // on the Jira issue (see estimation.js). Allowed to the same people as Reveal
    // - anyone, or only the facilitator in a led session - and only once the
    // round is revealed. The value must be a number card somebody actually
    // played this round. Jira itself then checks the person may edit the issue.
    resolver.define(
        'saveEstimate',
        handle(async (req) => {
            const { issueId, accountId } = await contextOf(req);
            const session = await readSession(issueId);

            if (!session) {
                throw new Error('There is no session to save an estimate from.');
            }

            if (!session.revealed) {
                throw new Error('Reveal the cards before saving the estimate.');
            }

            requireLead(session, accountId, 'save the estimate');

            const target = session.targets?.[session.targetIndex ?? 0];

            if (!target) {
                throw new Error('This space has no field to save estimates to yet.');
            }

            const card = req.payload?.value;
            const votes = await readVotes(issueId);
            const value = cardNumber(card);

            if (value === null || !votes.some((vote) => vote.card === card)) {
                throw new Error('Pick one of the number cards played this round.');
            }

            await saveFieldValue(issueId, target, value);

            const { name } = await currentUser();
            const saved = {
                fieldId: target.id,
                fieldName: target.name,
                card,
                value,
                round: session.round,
                savedBy: name,
                savedAt: Date.now(),
            };
            await writeSession(issueId, { ...session, saved });

            // Everyone viewing the issue sees it saved, and their issue panels
            // reload Jira's view of the issue so the field shows the new value.
            await broadcastToIssue(issueId, EVENTS.SAVED, { round: session.round, saved });

            return buildState(issueId, accountId);
        })
    );

    // Makes the caller the facilitator of a led session, so a session never gets
    // stuck when its facilitator leaves. The UI only offers this once the
    // facilitator has dropped out of "Who's here", but the server can't check
    // that - presence lives in the browsers - so anyone in the session may take
    // over. That's acceptable for a guard against accidents: everyone can see
    // who leads, and the change is announced to all.
    resolver.define(
        'takeOver',
        handle(async (req) => {
            const { issueId, accountId } = await contextOf(req);
            const session = await readSession(issueId);

            if (!session) {
                throw new Error('There is no session to lead.');
            }

            if (mayLead(session, accountId)) {
                return buildState(issueId, accountId);
            }

            const { name } = await currentUser();

            // Rewriting the shared session object could in principle race with a
            // reveal or a new round, but in a led session only the facilitator -
            // who is gone - can do those.
            await writeSession(issueId, { ...session, facilitator: accountId, facilitatorName: name });
            await broadcastToIssue(issueId, EVENTS.LEAD, {
                facilitator: accountId,
                facilitatorName: name,
            });

            return buildState(issueId, accountId);
        })
    );
}
