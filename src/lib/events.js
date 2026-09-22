import { publish } from '@forge/realtime';

// publish() is scoped to the current module context, so a panel on issue ABC-1
// only ever receives events published from a resolver invoked on ABC-1. That is
// exactly the audience we want, so no signed token or custom claims are needed.
const CHANNEL = 'planning-poker';

export const EVENTS = {
    STARTED: 'started',
    VOTED: 'voted',
    REVEALED: 'revealed',
    RESET: 'reset',
    SAVED: 'saved',
    ENDED: 'ended',
};

// A failed broadcast must not fail the user's action: by the time we publish, the
// change is already committed to storage. Other clients resync on their next
// getState, so a dropped event degrades to a stale panel rather than lost data.
export async function broadcast(type, payload = {}) {
    try {
        await publish(CHANNEL, { type, ...payload });
    } catch (error) {
        console.error(`realtime publish failed for "${type}"`, error);
    }
}
