import { invoke } from '@forge/bridge';

// Resolvers answer { ok, ... }; unwrap here so components only deal with data
// or a thrown Error.
async function call(name, payload) {
    const result = await invoke(name, payload);

    if (!result?.ok) {
        throw new Error(result?.error ?? 'Something went wrong.');
    }

    const { ok, ...data } = result;
    return data;
}

// Session calls for one issue. In the issue panel issueId is undefined and the
// backend uses the panel's own issue; on the refinement page it names the issue
// being estimated (and the backend checks the user may access it).
export function sessionApi(issueId) {
    return {
        getState: () => call('getState', { issueId }),
        startSession: (scale) => call('startSession', { issueId, scale }),
        castVote: (card) => call('castVote', { issueId, card }),
        reveal: () => call('reveal', { issueId }),
        revote: () => call('revote', { issueId }),
        endSession: () => call('endSession', { issueId }),
    };
}

export const getRefinement = () => call('getRefinement');
export const setFocus = (issueId) => call('setFocus', { issueId });
export const searchIssues = (text, chip, pageToken) =>
    call('searchIssues', { text, chip, pageToken });
export const addToQueue = (issueIds) => call('addToQueue', { issueIds });
export const removeFromQueue = (issueId) => call('removeFromQueue', { issueId });
export const clearQueue = () => call('clearQueue');
