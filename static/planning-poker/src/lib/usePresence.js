import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Jira, realtime, requestJira } from '@forge/bridge';

// Who has an issue's session open right now ("who's here"). Forge has no
// built-in presence, so every open view announces itself on a realtime channel -
// saying which issue it's on - repeats that every so often (a heartbeat), and
// says goodbye when it closes. Anyone not heard from for a while is assumed gone.
//
// This runs entirely between browsers: the events are published from the
// frontend and never touch a resolver or storage, so presence costs no function
// invocations or storage writes. Realtime is rate limited per installation (50
// operations per second, shared with the resolvers' broadcasts), which is why
// heartbeats are infrequent and the issue panel only runs presence while it
// matters.
//
// The channel is shared by the whole Jira project (contextOverrides), so an
// issue's panel and the refinement page see each other. The trade-off, chosen
// deliberately: anyone with the app open in the project receives presence
// messages - a name, an avatar and an issue *id* (no title, never a card) - even
// for an issue that Jira's issue security hides from them. In exchange, moving
// the refinement page to another issue is a single message instead of every
// viewer re-joining, which keeps big meetings well inside the rate limit.
//
// Presence is a hint, not a security boundary: any browser could publish a fake
// "here". It only drives what's on screen and when auto-reveal *asks* the server
// to reveal - and the server re-checks the votes itself before doing so.
const PRESENCE_CHANNEL = 'planning-poker-presence';
const PRESENCE_SCOPE = { contextOverrides: [Jira.Project] };

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

const issueIdFrom = (value) => (typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null);

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
        .publish(PRESENCE_CHANNEL, event, PRESENCE_SCOPE)
        .then((result) => {
            if (result?.errors?.length) {
                console.error('presence publish failed', result.errors);
            }
        })
        .catch((err) => console.error('presence publish failed', err));
}

// enabled: whether this view takes part in presence at all.
// issueId: the issue this view is showing a session for (null if none). On the
// refinement page it follows the current issue; changing it just re-announces.
//
// Returns, for that issue:
// - ready:   presence is up (subscribed and announced). Until then, nobody's
//            absence means anything, so callers shouldn't draw conclusions.
// - present: the people here, one entry per account, sorted by name so every
//            viewer sees the same order.
// - rank:    this tab's position among all tabs on the issue (0 = first). Lets
//            the tabs agree on who acts first without talking to each other.
// - hold / holdAutoReveal: the one shared signal the room needs besides
//            presence - someone asked auto-reveal to wait (see useAutoReveal).
export function usePresence(enabled, issueId) {
    // Other tabs, by client id: { person, issueId, seenAt }. This tab isn't in
    // here; it's added from `me` below.
    const [others, setOthers] = useState(() => new Map());
    const [me, setMe] = useState(null);
    const [ready, setReady] = useState(false);
    const [hold, setHold] = useState(null);
    const clientIdRef = useRef(null);
    const issueRef = useRef(issueId ?? null);
    const announceRef = useRef(null);

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
        let self = null;

        const gone = (id) =>
            setOthers((prev) => {
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
                    const entry = { person, issueId: issueIdFrom(event.issueId), seenAt: Date.now() };
                    setOthers((prev) => new Map(prev).set(event.clientId, entry));
                }
            } else if (event.type === 'leave') {
                gone(event.clientId);
            } else if (event.type === 'hold' && Number.isInteger(event.round)) {
                setHold({ issueId: issueIdFrom(event.issueId), round: event.round });
            }
        };

        const announce = () => {
            if (self) {
                send({ type: 'here', clientId, user: self, issueId: issueRef.current });
            }
        };

        const leave = () => {
            if (self) {
                send({ type: 'leave', clientId });
            }
        };

        // Drop tabs that stopped sending heartbeats (closed without saying goodbye).
        const sweep = () =>
            setOthers((prev) => {
                const cutoff = Date.now() - EXPIRY_MS;
                const stale = [...prev].filter(([, { seenAt }]) => seenAt < cutoff);
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
                self = await loadMe();
                if (!active) {
                    return;
                }

                setMe(self);

                subscription = await realtime.subscribe(PRESENCE_CHANNEL, onEvent, {
                    ...PRESENCE_SCOPE,
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

        announceRef.current = announce;
        const heartbeat = setInterval(announce, HEARTBEAT_MS);
        const sweeper = setInterval(sweep, SWEEP_MS);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', leave);

        return () => {
            active = false;
            announceRef.current = null;
            clearInterval(heartbeat);
            clearInterval(sweeper);
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', leave);
            leave();
            subscription?.unsubscribe();
            setOthers(new Map());
            setReady(false);
        };
    }, [enabled]);

    // Moving to another issue (refinement page) is announced at once, so the
    // others' "who's here" follows without waiting for the next heartbeat.
    useEffect(() => {
        issueRef.current = issueId ?? null;
        announceRef.current?.();
    }, [issueId]);

    const { present, rank } = useMemo(() => {
        const target = issueId ?? null;
        const here = target ? [...others].filter(([, entry]) => entry.issueId === target) : [];

        const people = new Map();
        if (ready && me && target) {
            people.set(me.accountId, me);
        }
        for (const [, { person }] of here) {
            if (!people.has(person.accountId)) {
                people.set(person.accountId, person);
            }
        }

        const tabs = [clientIdRef.current, ...here.map(([id]) => id)].sort();

        return {
            present: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
            rank: Math.max(0, tabs.indexOf(clientIdRef.current)),
        };
    }, [others, me, ready, issueId]);

    // issueId says which issue the hold is for, because the channel covers the
    // whole project.
    const holdAutoReveal = useCallback((holdIssueId, round) => {
        const target = holdIssueId ?? null;
        setHold({ issueId: target, round });
        send({ type: 'hold', clientId: clientIdRef.current, issueId: target, round });
    }, []);

    return { ready, present, rank, hold, holdAutoReveal };
}
