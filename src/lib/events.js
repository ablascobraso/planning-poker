import { Jira, publish, signRealtimeToken } from '@forge/realtime';

// Two kinds of live updates, on two channels.
//
// 1. SESSION events (an issue's votes, reveal, rounds, end, facilitator) must
//    reach everyone looking at that issue, whether through its issue panel or
//    through the project's refinement page. By default Forge scopes a channel to
//    the kind of view (module) it's used from, so those two would never hear
//    each other. So this channel is scoped to the Jira *project* instead
//    (contextOverrides), which both views share, and narrowed to one issue with
//    a signed token whose claims name that issue. Browsers get their token from
//    getState only after the usual access check, and it only lets them listen:
//    nobody without access to the issue receives its events, and no browser can
//    fake a vote or a reveal. That's also why reveal events can carry the cards
//    to every view.
//
// 2. PAGE events (the refinement page's queue and current issue) only concern
//    the refinement page, so they keep Forge's default scoping: a project's
//    refinement pages hear each other, nothing else does.
const SESSION_CHANNEL = 'planning-poker-session';
const PAGE_CHANNEL = 'planning-poker';

// Must be identical wherever the session channel is used - here and in the
// frontend's subscribe() - or events silently stop arriving.
const SESSION_SCOPE = { contextOverrides: [Jira.Project] };

export const EVENTS = {
    STARTED: 'started',
    VOTED: 'voted',
    REVEALED: 'revealed',
    RESET: 'reset',
    ENDED: 'ended',
    LEAD: 'lead',
    FOCUS: 'focus',
    QUEUE: 'queue',
};

// Token claims are matched exactly between publisher and subscriber, so both
// sides must build them the same way.
const issueClaims = (issueId) => ({ issueId: String(issueId) });

// A listen-only token for one issue's session events, handed to a browser that
// has just passed the access check for that issue. Returns null if signing
// fails; the browser then simply has no live updates until it asks again.
export async function sessionToken(issueId) {
    try {
        const { token, expiresAt, errors } = await signRealtimeToken(
            SESSION_CHANNEL,
            issueClaims(issueId),
            ['subscribe']
        );

        if (!token) {
            console.error('realtime token signing failed', errors);
            return null;
        }

        // Tokens currently last an hour (measured; not documented). The browser
        // renews its token shortly before expiresAt, so this may change freely.
        return { token, expiresAt };
    } catch (error) {
        console.error('realtime token signing failed', error);
        return null;
    }
}

// A failed broadcast must not fail the user's action: by the time we publish, the
// change is already committed to storage. Other clients resync on their next
// getState, so a dropped event degrades to a stale view rather than lost data.
async function publishSafely(channel, type, payload, options) {
    try {
        const result = await publish(channel, { type, ...payload }, options);

        if (result?.errors) {
            console.error(`realtime publish failed for "${type}"`, result.errors);
        }
    } catch (error) {
        console.error(`realtime publish failed for "${type}"`, error);
    }
}

// Sends a session event to everyone watching this issue, in any view. Signing
// a publish token per event costs one extra realtime operation; it keeps this
// simple and stateless, and actions are rare enough for that not to matter.
export async function broadcastToIssue(issueId, type, payload = {}) {
    try {
        const { token, errors } = await signRealtimeToken(
            SESSION_CHANNEL,
            issueClaims(issueId),
            ['publish']
        );

        if (!token) {
            console.error(`realtime token signing failed for "${type}"`, errors);
            return;
        }

        await publishSafely(SESSION_CHANNEL, type, { issueId, ...payload }, { ...SESSION_SCOPE, token });
    } catch (error) {
        console.error(`realtime token signing failed for "${type}"`, error);
    }
}

// Sends a refinement-page event (queue, current issue) to the project's
// refinement pages.
export async function broadcast(type, payload = {}) {
    await publishSafely(PAGE_CHANNEL, type, payload);
}
