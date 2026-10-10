import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Jira, realtime, view } from '@forge/bridge';

import { sessionApi } from './api';

// The refinement page's own channel (queue, current issue). See events.js.
export const PAGE_CHANNEL = 'planning-poker';

// An issue's session events reach every view of that issue - its issue panel
// and the refinement page - because the channel is scoped to the Jira project
// and narrowed to the issue by a listen-only token from getState. The scope
// must match the backend's exactly (events.js), or nothing arrives.
const SESSION_CHANNEL = 'planning-poker-session';
const SESSION_SCOPE = { contextOverrides: [Jira.Project] };

// Tokens expire, so a fresh one is fetched (with a fresh snapshot) this long
// before that. If fetching one fails, it's retried after RETRY_TOKEN_MS.
const RENEW_BEFORE_MS = 60 * 1000;
const RETRY_TOKEN_MS = 30 * 1000;

const EMPTY = {
    session: null,
    cards: [],
    scales: [],
    votes: [],
    myVote: null,
    // Earlier revealed rounds of this session, oldest first (see session.js).
    history: [],
    // The fields a new session would save its estimates to (start screen).
    targets: [],
    defaultScale: null,
    defaultLed: false,
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

    // The live-update token: kept in a ref so refresh() can tell whether a new
    // one is needed, mirrored in state so the subscription follows changes.
    const liveRef = useRef(null);
    const [live, setLive] = useState(null);
    const retryTimer = useRef(null);

    const refresh = useCallback(async () => {
        const current = liveRef.current;
        const needsToken = !current || current.expiresAt * 1000 - Date.now() < RENEW_BEFORE_MS;

        try {
            const { live: fresh, ...data } = await api.getState(needsToken);

            if (fresh) {
                liveRef.current = fresh;
                setLive(fresh);
            } else if (needsToken) {
                clearTimeout(retryTimer.current);
                retryTimer.current = setTimeout(refresh, RETRY_TOKEN_MS);
            }

            setState((prev) => ({ ...prev, ...EMPTY, ...data }));
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [api]);

    // Renews the token shortly before it expires.
    useEffect(() => {
        if (!live?.expiresAt) {
            return undefined;
        }

        const wait = Math.max(live.expiresAt * 1000 - Date.now() - RENEW_BEFORE_MS, RETRY_TOKEN_MS);
        const timer = setTimeout(refresh, wait);
        return () => clearTimeout(timer);
    }, [live, refresh]);

    useEffect(() => () => clearTimeout(retryTimer.current), []);

    // After an estimate is saved, the issue panel asks Jira to reload the issue
    // (view.refresh), so the field shows its new value without reloading the
    // page. It happens for the person saving and, through the "saved" event,
    // for everyone else on the issue. The refinement page has no issue view to
    // reload (issueId is set there), so it skips this. Each save is reloaded
    // once, however many times it's reported.
    const refreshedSave = useRef(null);
    const showSavedInJira = useCallback(
        (saved) => {
            if (issueId || !saved?.savedAt || refreshedSave.current === saved.savedAt) {
                return;
            }
            refreshedSave.current = saved.savedAt;
            view.refresh().catch((err) => console.warn('issue view refresh unavailable', err));
        },
        [issueId]
    );

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

            if (payload.type === 'saved') {
                showSavedInJira(payload.saved);
            }

            // The token already limits events to this issue; this is a cheap
            // safety net on the refinement page, which names its issue.
            if (issueId && payload.issueId !== issueId) {
                return;
            }

            // An event for a different round means this view missed something,
            // and a reveal without cards can only come from an older version of
            // the app. Either way, pull a fresh snapshot.
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
                            // Starting a session also made its deck and lead
                            // choice the space's defaults.
                            defaultScale: payload.scale,
                            defaultLed: payload.led === true,
                            cards: payload.cards ?? prev.cards,
                            session: {
                                ...(prev.session ?? {}),
                                scale: payload.scale,
                                revealed: false,
                                round: payload.round,
                                led: payload.led === true,
                                facilitator: payload.facilitator,
                                facilitatorName: payload.facilitatorName ?? null,
                                targets: payload.targets ?? [],
                                targetIndex: payload.targetIndex ?? 0,
                                saved: null,
                            },
                        };

                    case 'voted': {
                        const others = prev.votes.filter(
                            (vote) => vote.accountId !== payload.voter.accountId
                        );
                        return { ...prev, votes: [...others, payload.voter] };
                    }

                    case 'revealed': {
                        // The just-revealed round joins the history (replacing
                        // it, should the same round be revealed twice).
                        const entry = payload.historyEntry;
                        const history = entry
                            ? [...prev.history.filter((past) => past.round !== entry.round), entry]
                            : prev.history;
                        return {
                            ...prev,
                            votes: payload.votes,
                            history,
                            session: { ...prev.session, revealed: true },
                        };
                    }

                    case 'reset':
                        return {
                            ...prev,
                            votes: [],
                            myVote: null,
                            session: {
                                ...prev.session,
                                revealed: false,
                                round: payload.round,
                                saved: null,
                            },
                        };

                    // An estimate was saved to the issue (by anyone).
                    case 'saved':
                        return prev.session
                            ? { ...prev, session: { ...prev.session, saved: payload.saved } }
                            : prev;

                    case 'ended':
                        return {
                            ...prev,
                            ...EMPTY,
                            scales: prev.scales,
                            defaultScale: prev.defaultScale ?? prev.session?.scale ?? null,
                            // The ended session's choice is the space's latest default.
                            defaultLed: prev.session ? prev.session.led === true : prev.defaultLed,
                            // Its fields are the space's, so the start screen can keep
                            // saying where the next session saves to.
                            targets: prev.session?.targets ?? prev.targets,
                        };

                    // Someone took over a led session.
                    case 'lead':
                        return prev.session
                            ? {
                                  ...prev,
                                  session: {
                                      ...prev.session,
                                      facilitator: payload.facilitator,
                                      facilitatorName: payload.facilitatorName ?? null,
                                  },
                              }
                            : prev;

                    default:
                        return prev;
                }
            });
        };

        // Nothing to listen with until getState has handed out a token.
        if (!live?.token) {
            return undefined;
        }

        let active = true;
        let subscription;

        realtime
            .subscribe(SESSION_CHANNEL, onEvent, { ...SESSION_SCOPE, token: live.token })
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
    }, [refresh, issueId, live, showSavedInJira]);

    const actions = {
        start: (scale, led) => run(() => api.startSession(scale, led)),
        // Starts a fresh session on the same issue for the space's next
        // estimation field ("Next: QA estimate"), keeping the deck and lead choice.
        nextTarget: () => {
            const { scale, led, targetIndex = 0 } = state.session ?? {};
            return run(() => api.startSession(scale, led, targetIndex + 1));
        },
        saveEstimate: async (value) => {
            const data = await run(() => api.saveEstimate(value));
            showSavedInJira(data?.session?.saved);
            return data;
        },
        vote: (card) => run(() => api.castVote(card)),
        reveal: () => run(api.reveal),
        autoReveal: (round, accountIds) => run(() => api.autoReveal(round, accountIds)),
        revote: () => run(api.revote),
        end: () => run(api.endSession),
        takeOver: () => run(api.takeOver),
    };

    return { ...state, loading, busy, error, actions, dismissError: () => setError(null) };
}
