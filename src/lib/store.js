import { kvs, WhereConditions } from '@forge/kvs';

// Keys are namespaced by issue *id* rather than issue key, because an issue key
// changes when the issue moves between projects but the id never does.
//
// Each vote lives under its own key instead of inside the session object. KVS has
// no conditional writes or optimistic locking, so a read-modify-write on a shared
// session object would silently drop votes whenever two people voted at the same
// moment - which in planning poker is the normal case, not an edge case.
const sessionKey = (issueId) => `pp:s:${issueId}`;
const focusKey = (projectId) => `pp:f:${projectId}`;
const deckKey = (projectId) => `pp:d:${projectId}`;
const voteKey = (issueId, accountId) => `pp:v:${issueId}:${accountId}`;
const votePrefix = (issueId) => `pp:v:${issueId}:`;

const TRANSACTION_LIMIT = 25;

// An issue should be estimated within a few days, so a session lives 72 hours (long
// enough to span a weekend) from its last start, reveal or new round. Forge deletes
// expired keys on its own, which keeps stored personal data (names, avatars) and
// storage use low. Deletion can lag up to another 48 hours and reads may still return
// expired keys meanwhile, so readSession also checks the age recorded on the session.
const LIFETIME_HOURS = 72;
const LIFETIME_MS = LIFETIME_HOURS * 60 * 60 * 1000;
const EXPIRY = { ttl: { unit: 'HOURS', value: LIFETIME_HOURS } };

export async function readSession(issueId) {
    const session = await kvs.get(sessionKey(issueId));

    if (!session) {
        return null;
    }

    const touchedAt = session.updatedAt ?? session.startedAt ?? 0;
    return Date.now() - touchedAt > LIFETIME_MS ? null : session;
}

export async function writeSession(issueId, session) {
    await kvs.set(sessionKey(issueId), { ...session, updatedAt: Date.now() }, EXPIRY);
}

// The issue a project's refinement page is currently estimating, shared so that
// everyone on the page moves to the next issue together.
export async function readFocus(projectId) {
    const focus = await kvs.get(focusKey(projectId));

    if (!focus || Date.now() - focus.updatedAt > LIFETIME_MS) {
        return null;
    }

    return focus;
}

export async function writeFocus(projectId, issueId) {
    await kvs.set(focusKey(projectId), { issueId, updatedAt: Date.now() }, EXPIRY);
}

// The deck a Jira space (project) uses by default: whichever was picked for the
// most recent session there. It's a team preference rather than session data, so
// unlike everything else it doesn't expire.
export async function readDefaultDeck(projectId) {
    const deck = await kvs.get(deckKey(projectId));
    return deck?.scale ?? null;
}

export async function writeDefaultDeck(projectId, scale) {
    await kvs.set(deckKey(projectId), { scale, updatedAt: Date.now() });
}

export async function deleteSession(issueId) {
    await kvs.delete(sessionKey(issueId));
}

// Votes deliberately don't touch the session: rewriting the shared session object
// on every vote could race with a reveal and silently un-reveal the round.
export async function writeVote(issueId, accountId, vote) {
    await kvs.set(voteKey(issueId, accountId), vote, EXPIRY);
}

// A reveal extends the session, so re-stamp its votes too - otherwise votes cast
// early in the round could expire while the revealed results are still on screen.
export async function renewVotes(issueId, votes) {
    for (let i = 0; i < votes.length; i += TRANSACTION_LIMIT) {
        const batch = votes.slice(i, i + TRANSACTION_LIMIT);
        const transaction = batch.reduce(
            (tx, { accountId, ...vote }) => tx.set(voteKey(issueId, accountId), vote, EXPIRY),
            kvs.transact()
        );
        await transaction.execute();
    }
}

export async function readVotes(issueId) {
    const prefix = votePrefix(issueId);
    const votes = [];
    let cursor;

    do {
        let query = kvs
            .query()
            .where('key', WhereConditions.beginsWith(prefix))
            .limit(TRANSACTION_LIMIT);

        if (cursor) {
            query = query.cursor(cursor);
        }

        const { results, nextCursor } = await query.getMany();

        for (const { key, value } of results) {
            votes.push({ accountId: key.slice(prefix.length), ...value });
        }

        cursor = nextCursor;
    } while (cursor);

    return votes;
}

export async function clearVotes(issueId) {
    const votes = await readVotes(issueId);

    for (let i = 0; i < votes.length; i += TRANSACTION_LIMIT) {
        const batch = votes.slice(i, i + TRANSACTION_LIMIT);
        const transaction = batch.reduce(
            (tx, { accountId }) => tx.delete(voteKey(issueId, accountId)),
            kvs.transact()
        );
        await transaction.execute();
    }
}
