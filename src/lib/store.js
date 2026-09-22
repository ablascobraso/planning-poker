import { kvs, WhereConditions } from '@forge/kvs';

// Keys are namespaced by issue *id* rather than issue key, because an issue key
// changes when the issue moves between projects but the id never does.
//
// Each vote lives under its own key instead of inside the session object. KVS has
// no conditional writes or optimistic locking, so a read-modify-write on a shared
// session object would silently drop votes whenever two people voted at the same
// moment - which in planning poker is the normal case, not an edge case.
const sessionKey = (issueId) => `pp:s:${issueId}`;
const voteKey = (issueId, accountId) => `pp:v:${issueId}:${accountId}`;
const votePrefix = (issueId) => `pp:v:${issueId}:`;

const TRANSACTION_LIMIT = 25;

export async function readSession(issueId) {
    const session = await kvs.get(sessionKey(issueId));
    return session ?? null;
}

export async function writeSession(issueId, session) {
    await kvs.set(sessionKey(issueId), session);
}

export async function deleteSession(issueId) {
    await kvs.delete(sessionKey(issueId));
}

export async function writeVote(issueId, accountId, vote) {
    await kvs.set(voteKey(issueId, accountId), vote);
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
