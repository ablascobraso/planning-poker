// Stand-in for @forge/api: a tiny fake Jira. Tests register how it answers a
// request (method + path), and every request is recorded so tests can check
// what the app asked Jira to do - for example the body of an issue edit.
//
// Anything not registered answers 404, like an unknown Jira endpoint. Every
// test gets a default "who am I" answer (see reset).

const handlers = [];
const requests = [];

export function respond(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => structuredClone(body),
        text: async () => JSON.stringify(body),
    };
}

export const jira = {
    requests,

    // match: a path prefix (string) or a RegExp. Later registrations win, so a
    // test can override a default answer.
    on(method, match, answer) {
        handlers.unshift({ method: method.toUpperCase(), match, answer });
    },

    requestsTo(method, match) {
        return requests.filter(
            (request) =>
                request.method === method.toUpperCase() &&
                (typeof match === 'string' ? request.path.startsWith(match) : match.test(request.path))
        );
    },

    reset() {
        handlers.length = 0;
        requests.length = 0;
        jira.on('GET', '/rest/api/3/myself', () =>
            respond(200, {
                displayName: 'Test User',
                avatarUrls: { '24x24': 'https://avatar.example/test.png' },
            })
        );
    },
};

jira.reset();

// Like @forge/api's route tag: builds the path, encoding interpolated values.
export function route(strings, ...values) {
    return strings.reduce(
        (path, part, index) =>
            path + part + (index < values.length ? encodeURIComponent(String(values[index])) : ''),
        ''
    );
}

async function requestJira(path, options = {}) {
    const method = (options.method ?? 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ method, path, body });

    const handler = handlers.find(
        ({ method: wanted, match }) =>
            wanted === method &&
            (typeof match === 'string' ? path.startsWith(match) : match.test(path))
    );

    return handler ? handler.answer({ path, body }) : respond(404, { errorMessages: ['Not found'] });
}

const api = {
    asUser: () => ({ requestJira }),
    asApp: () => ({ requestJira }),
};

export default api;
