// In-memory stand-in for @forge/kvs (Forge's Key-Value Store), with the calls
// the app uses: get, set, delete, prefix queries with paging, and transactions.
// Values are copied in and out, like a real store, so tests can't accidentally
// share objects with the code under test.

const data = new Map(); // key -> { value, options }

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

export const kvsState = {
    data,
    reset() {
        data.clear();
    },
    // The options (e.g. expiry) a key was last written with.
    optionsOf(key) {
        return data.get(key)?.options;
    },
};

export const WhereConditions = {
    beginsWith: (prefix) => ({ condition: 'BEGINS_WITH', value: prefix }),
};

export const kvs = {
    async get(key) {
        return copy(data.get(key)?.value);
    },

    async set(key, value, options) {
        data.set(key, { value: copy(value), options });
    },

    async delete(key) {
        data.delete(key);
    },

    query() {
        let prefix = '';
        let limit = Infinity;
        let start = 0;

        const query = {
            where(_field, condition) {
                prefix = condition.value;
                return query;
            },
            limit(count) {
                limit = count;
                return query;
            },
            cursor(cursor) {
                start = Number(cursor);
                return query;
            },
            async getMany() {
                const keys = [...data.keys()].filter((key) => key.startsWith(prefix)).sort();
                const page = keys.slice(start, start + limit);
                const end = start + page.length;
                return {
                    results: page.map((key) => ({ key, value: copy(data.get(key).value) })),
                    nextCursor: end < keys.length ? String(end) : undefined,
                };
            },
        };

        return query;
    },

    transact() {
        const operations = [];
        const transaction = {
            set(key, value, options) {
                operations.push(() => data.set(key, { value: copy(value), options }));
                return transaction;
            },
            delete(key) {
                operations.push(() => data.delete(key));
                return transaction;
            },
            async execute() {
                operations.forEach((operation) => operation());
            },
        };
        return transaction;
    },
};
