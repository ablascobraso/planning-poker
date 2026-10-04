import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { realtime, requestJira } from '@forge/bridge';

// Who has this session open right now ("who's here"). Forge has no built-in
// presence, so every open view announces itself on a realtime channel, repeats
// that every so often (a heartbeat), and says goodbye when it closes. Anyone not
// heard from for a while is assumed gone.
//
// This runs entirely between browsers: the events are published from the
// frontend and never touch a resolver or storage, so presence costs no function
// invocations or storage writes. Realtime is rate limited per installation (50
// operations per second, shared with the resolvers' broadcasts), which is why
// heartbeats are infrequent and the issue panel only runs presence while a round
// is open.
//
// Presence is a hint, not a security boundary: any browser could publish a fake
// "here". It only drives what's on screen and when auto-reveal *asks* the server
// to reveal - and the server re-checks the votes itself before doing so.
//
// The channel is scoped like the session events: an issue panel hears only the
// panels open on the same issue, a refinement page hears only that project's
// refinement pages. The two never see each other.
const PRESENCE_CHANNEL = 'planning-poker-presence';

const HEARTBEAT_MS = 30 * 1000;
// Browsers slow timers in background tabs down to about once a minute, so a
// viewer is only dropped after missing well over a minute of heartbeats.
const EXPIRY_MS = 100 * 1000;
const SWEEP_MS = 10 * 1000;
// On subscribing, Forge replays the channel's recent events, so a newcomer sees
// everyone who announced themselves within the last heartbeat straight away,
// without every viewer having to answer each newcomer.
const REPLAY_SECONDS = 45;

// The viewer's own name and avatar, fetched once per page load. The browser asks
// Jira directly (covered by the app's read:jira-user scope), so this costs no
// resolver call. A failure is not cached, so the next attempt retries.
let mePromise = null;

function loadMe() {
    if (!mePromise) {
        mePromise = requestJira('/rest/api/3/myself')
            .then((response) =>
                response.ok
                    ? response.json()
                    : Promise.reject(new Error(`Jira answered ${response.status}`))
            )
            .then(({ accountId, displayName, avatarUrls }) => ({
                accountId,
                name: displayName ?? 'Unknown user',
                avatar: avatarUrls?.['24x24'] ?? null,
            }))
            .catch((err) => {
                mePromise = null;
                throw err;
            });
    }

    return mePromise;
}

// Identifies this browser tab. One person can have the session open in two tabs,
// so tabs (not accounts) are what come and go.
function newClientId() {
    return window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Events arrive from other browsers, so only well-formed fields are kept. React
// escapes the name when rendering; the avatar must be an https URL.
function personFrom(user) {
    if (!user || typeof user.accountId !== 'string' || !/^[\w:-]{1,128}$/.test(user.accountId)) {
        return null;
    }

    return {
        accountId: user.accountId,
        name: typeof user.name === 'string' && user.name.trim() ? user.name.slice(0, 100) : 'Unknown user',
        avatar: typeof user.avatar === 'string' && user.avatar.startsWith('https://') ? user.avatar : null,
    };
}

function parse(payload) {
    if (typeof payload !== 'string') {
        return payload;
    }

    try {
        return JSON.parse(payload);
    } catch {
        return null;
    }
}

// Logs instead of throwing: a lost presence event degrades to a slightly stale
// "who's here" list, which the next heartbeat corrects.
function send(event) {
    realtime
        .publish(PRESENCE_CHANNEL, event)
        .then((result) => {
            if (result?.errors?.length) {
                console.error('presence publish failed', result.errors);
            }
        })
        .catch((err) => console.error('presence publish failed', err));
}

// Returns:
// - ready:   presence is up (subscribed and announced). Until then, nobody's
//            absence means anything, so callers shouldn't draw conclusions.
// - present: the people here, one entry per account, sorted by name so every
//            viewer sees the same order.
// - rank:    this tab's position among all tabs here (0 = first). Lets the tabs
//            agree on who acts first without talking to each other.
// - hold / holdAutoReveal: the one shared signal the room needs besides
//            presence - someone asked auto-reveal to wait (see useAutoReveal).
export function usePresence(enabled) {
    const [clients, setClients] = useState(() => new Map());
    const [ready, setReady] = useState(false);
    const [hold, setHold] = useState(null);
    const clientIdRef = useRef(null);

    if (!clientIdRef.current) {
        clientIdRef.current = newClientId();
    }

    useEffect(() => {
        if (!enabled) {
            return undefined;
        }

        const clientId = clientIdRef.current;
        let active = true;
        let subscription = null;
        let me = null;

        const seen = (id, person) =>
            setClients((prev) => new Map(prev).set(id, { person, seenAt: Date.now() }));

        const gone = (id) =>
            setClients((prev) => {
                if (!prev.has(id)) {
                    return prev;
                }
                const next = new Map(prev);
                next.delete(id);
                return next;
            });

        const onEvent = (raw) => {
            const event = parse(raw);

            // Our own events may be echoed back (including replayed ones from an
            // earlier round); this tab tracks itself locally instead.
            if (!event || typeof event.clientId !== 'string' || event.clientId === clientId) {
                return;
            }

            if (event.type === 'here') {
                const person = personFrom(event.user);
                if (person) {
                    seen(event.clientId, person);
                }
            } else if (event.type === 'leave') {
                gone(event.clientId);
            } else if (event.type === 'hold' && Number.isInteger(event.round)) {
                setHold({ issueId: typeof event.issueId === 'string' ? event.issueId : null, round: event.round });
            }
        };

        const announce = () => {
            if (me) {
                send({ type: 'here', clientId, user: me });
            }
        };

        const leave = () => {
            if (me) {
                send({ type: 'leave', clientId });
            }
        };

        // Drop tabs that stopped sending heartbeats (closed without saying goodbye).
        // This tab never expires itself.
        const sweep = () =>
            setClients((prev) => {
                const cutoff = Date.now() - EXPIRY_MS;
                const stale = [...prev].filter(([id, { seenAt }]) => id !== clientId && seenAt < cutoff);
                if (stale.length === 0) {
                    return prev;
                }
                const next = new Map(prev);
                stale.forEach(([id]) => next.delete(id));
                return next;
            });

        // A tab coming back to the foreground may have had its heartbeats slowed
        // down, so it re-announces itself straight away.
        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                announce();
            }
        };

        (async () => {
            try {
                me = await loadMe();
                if (!active) {
                    return;
                }

                seen(clientId, me);

                subscription = await realtime.subscribe(PRESENCE_CHANNEL, onEvent, {
                    replaySeconds: REPLAY_SECONDS,
                });
                if (!active) {
                    subscription.unsubscribe();
                    return;
                }

                setReady(true);
                announce();
            } catch (err) {
                console.error('presence unavailable', err);
            }
        })();

        const heartbeat = setInterval(announce, HEARTBEAT_MS);
        const sweeper = setInterval(sweep, SWEEP_MS);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', leave);

        return () => {
            active = false;
            clearInterval(heartbeat);
            clearInterval(sweeper);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', leave);
            leave();
            subscription?.unsubscribe();
            setClients(new Map());
            setReady(false);
        };
    }, [enabled]);

    const { present, rank } = useMemo(() => {
        const people = new Map();
        for (const { person } of clients.values()) {
            if (!people.has(person.accountId)) {
                people.set(person.accountId, person);
            }
        }

        return {
            present: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
            rank: Math.max(0, [...clients.keys()].sort().indexOf(clientIdRef.current)),
        };
    }, [clients]);

    // issueId tells refinement-page viewers which issue the hold is for, because
    // the page's channel covers the whole project. The panel passes none.
    const holdAutoReveal = useCallback((issueId, round) => {
        const target = issueId ?? null;
        setHold({ issueId: target, round });
        send({ type: 'hold', clientId: clientIdRef.current, issueId: target, round });
    }, []);

    return { ready, present, rank, hold, holdAutoReveal };
}
