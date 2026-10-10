// Stand-in for @forge/realtime: records every published event so tests can
// check what reached the browsers, and hands out recognisable fake tokens.

export const Jira = { Board: 'board', Issue: 'issue', Project: 'project' };

const published = [];

export const realtimeState = {
    published,
    reset() {
        published.length = 0;
    },
    // Published events of one type, e.g. eventsOfType('voted').
    eventsOfType(type) {
        return published.filter((event) => event.payload?.type === type);
    },
};

export async function publish(channel, payload, options) {
    published.push({ channel, payload: structuredClone(payload), options });
    return { eventId: `event-${published.length}`, eventTimestamp: new Date().toISOString() };
}

export async function publishGlobal(channel, payload, options) {
    return publish(channel, payload, options);
}

export async function signRealtimeToken(channel, claims, permissions = ['subscribe', 'publish']) {
    return {
        token: `token:${channel}:${JSON.stringify(claims)}:${permissions.join('+')}`,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };
}
