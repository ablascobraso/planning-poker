import { publish } from '@forge/realtime';

// publish() is scoped to the module context the resolver was invoked from: an
// issue panel event reaches only that issue's panels, and a refinement page event
// reaches only that project's refinement pages. The two never see each other's
// events, so page events carry the issueId and page clients filter on it.
const CHANNEL = 'planning-poker';

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
