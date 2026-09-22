import { useCallback, useEffect, useRef, useState } from 'react';
import { realtime } from '@forge/bridge';

import * as api from './api';

const CHANNEL = 'planning-poker';

const EMPTY = {
    session: null,
    cards: [],
    scales: [],
    votes: [],
    myVote: null,
};

export function useSession() {
    const [state, setState] = useState({ ...EMPTY, issueKey: null, me: null });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [estimate, setEstimate] = useState(null);

    // Mirrors the active round so incoming events can be checked for staleness
    // without reading state inside a setState updater, which must stay pure.
    const roundRef = useRef(null);
    const round = state.session?.round ?? null;

    useEffect(() => {
        roundRef.current = round;
    }, [round]);

    const refresh = useCallback(async () => {
        try {
            const data = await api.getState();
            setState((prev) => ({ ...prev, ...EMPTY, ...data }));
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Wraps the one-off actions so every button gets the same busy/error handling.
    const run = useCallback(async (action) => {
        setBusy(true);
        try {
            const data = await action();
            setState((prev) => ({ ...prev, ...data }));
            setError(null);
            return data;
        } catch (err) {
            setError(err.message);
            return null;
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        const onEvent = (payload) => {
            if (!payload || typeof payload !== 'object') {
                return;
            }

            // An event for a different round means this panel missed something;
            // pull a fresh snapshot rather than patching stale state.
            const roundScoped = payload.type === 'voted' || payload.type === 'revealed';
            if (roundScoped && payload.round !== roundRef.current) {
                refresh();
                return;
            }

            if (payload.type === 'saved') {
                setEstimate(payload.estimate);
                return;
            }

            // A new round makes any earlier "Saved N story points" notice stale -
            // it referred to a previous round's result, not this one.
            if (payload.type === 'started' || payload.type === 'reset' || payload.type === 'ended') {
                setEstimate(null);
            }

            setState((prev) => {
                switch (payload.type) {
                    case 'started':
                        return {
                            ...prev,
                            ...EMPTY,
                            scales: prev.scales,
                            cards: payload.cards ?? prev.cards,
                            session: {
                                ...(prev.session ?? {}),
                                scale: payload.scale,
                                revealed: false,
                                round: payload.round,
                            },
                        };

                    case 'voted': {
                        const others = prev.votes.filter(
                            (vote) => vote.accountId !== payload.voter.accountId
                        );
                        return { ...prev, votes: [...others, payload.voter] };
                    }

                    case 'revealed':
                        return {
                            ...prev,
                            votes: payload.votes ?? prev.votes,
                            session: { ...prev.session, revealed: true },
                        };

                    case 'reset':
                        return {
                            ...prev,
                            votes: [],
                            myVote: null,
                            session: { ...prev.session, revealed: false, round: payload.round },
                        };

                    case 'ended':
                        return { ...prev, ...EMPTY, scales: prev.scales };

                    default:
                        return prev;
                }
            });
        };

        let active = true;
        let subscription;

        realtime
            .subscribe(CHANNEL, onEvent)
            .then((sub) => {
                subscription = sub;
                if (!active) {
                    sub.unsubscribe();
                }
            })
            .catch((err) => console.error('realtime subscribe failed', err));

        return () => {
            active = false;
            subscription?.unsubscribe();
        };
    }, [refresh]);

    const actions = {
        start: (scale) => {
            setEstimate(null);
            return run(() => api.startSession(scale));
        },
        vote: (card) => run(() => api.castVote(card)),
        reveal: () => run(api.reveal),
        revote: () => {
            setEstimate(null);
            return run(api.revote);
        },
        end: () => {
            setEstimate(null);
            return run(api.endSession);
        },
        save: async (value) => {
            const data = await run(() => api.saveEstimate(value));
            if (data) {
                setEstimate(data.estimate);
            }
            return data;
        },
    };

    return { ...state, loading, busy, error, estimate, actions, dismissError: () => setError(null) };
}
