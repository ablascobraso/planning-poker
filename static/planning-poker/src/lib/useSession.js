import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { realtime } from '@forge/bridge';

import { sessionApi } from './api';

export const CHANNEL = 'planning-poker';

const EMPTY = {
    session: null,
    cards: [],
    scales: [],
    votes: [],
    myVote: null,
};

// State and actions for one issue's session. Pass an issueId on the refinement
// page; leave it out in the issue panel. The hook assumes issueId never changes
// for its lifetime - the page remounts it (via `key`) when moving to another issue.
export function useSession(issueId) {
    const api = useMemo(() => sessionApi(issueId), [issueId]);
    const [state, setState] = useState({ ...EMPTY, issueKey: null, me: null });
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);

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
    }, [api]);

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

            // A refinement page hears events for every issue in the project.
            if (issueId && payload.issueId !== issueId) {
                return;
            }

            // An event for a different round means this view missed something, and
            // a reveal without cards (refinement page) means each viewer must fetch
            // them through the access-checked getState. Either way, pull a snapshot.
            const roundScoped = payload.type === 'voted' || payload.type === 'revealed';
            const staleRound = roundScoped && payload.round !== roundRef.current;
            const cardsWithheld = payload.type === 'revealed' && !payload.votes;
            if (staleRound || cardsWithheld) {
                refresh();
                return;
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
                            votes: payload.votes,
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
    }, [refresh, issueId]);

    const actions = {
        start: (scale) => run(() => api.startSession(scale)),
        vote: (card) => run(() => api.castVote(card)),
        reveal: () => run(api.reveal),
        revote: () => run(api.revote),
        end: () => run(api.endSession),
    };

    return { ...state, loading, busy, error, actions, dismissError: () => setError(null) };
}
