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

export const getState = () => call('getState');
export const startSession = (scale) => call('startSession', { scale });
export const castVote = (card) => call('castVote', { card });
export const reveal = () => call('reveal');
export const revote = () => call('revote');
export const endSession = () => call('endSession');
export const saveEstimate = (value) => call('saveEstimate', { value });
