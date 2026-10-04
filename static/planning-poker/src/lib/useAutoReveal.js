import { useEffect, useRef, useState } from 'react';

// How long everyone sees "Everyone has voted, revealing in 3s" before the cards
// turn. It gives a last-second voter time to change their card, and anyone time
// to press "Wait".
const COUNTDOWN_MS = 3000;
// Every tab in the room runs the same countdown, but only the first (rank 0)
// asks for the reveal on time. The others wait a little longer each, in rank
// order, and only step in if that first tab has gone quiet - otherwise the
// reveal event arrives first and cancels their timers.
const STAGGER_MS = 2000;
// Auto-reveal is for a group. Alone, you'd see your own card flip the moment
// you picked it, so a single viewer reveals by hand as before.
const MIN_ROOM_SIZE = 2;

// Reveals the cards automatically once everybody here has voted, and works out
// who we're still waiting for. Takes the useSession() result, the usePresence()
// result, and (on the refinement page) the issue being estimated.
//
// Pressing "Wait" holds auto-reveal for the rest of the round, for everyone; the
// Reveal button keeps working. A hold is tied to the round, so the next round
// starts with auto-reveal back on.
//
// Led sessions never auto-reveal: their facilitator decides when. They still
// report everyoneVoted, so the facilitator can be told it's time. And since the
// facilitator runs the meeting and may not vote, nobody waits for them.
export function useAutoReveal({ session, votes, actions }, presence, issueId) {
    const round = session?.round ?? null;
    const open = Boolean(session) && !session.revealed;

    const led = session?.led === true;
    const facilitator = led ? session.facilitator : null;

    // Both "waiting for…" and auto-reveal only mean something for a group.
    const group = open && presence.ready && presence.present.length >= MIN_ROOM_SIZE;

    const voted = new Set(votes.map((vote) => vote.accountId));
    const voters = presence.present.filter((person) => person.accountId !== facilitator);
    const waitingFor = group ? voters.filter((person) => !voted.has(person.accountId)) : [];
    const everyoneVoted = group && voters.length > 0 && waitingFor.length === 0;

    const held = Boolean(
        presence.hold && presence.hold.round === round && presence.hold.issueId === (issueId ?? null)
    );

    const armed = everyoneVoted && !led && !held;

    const [deadline, setDeadline] = useState(null);
    const [now, setNow] = useState(() => Date.now());

    // The timers below outlive individual renders, so they read the latest
    // values from here rather than from the render that started them.
    const latest = useRef(null);
    latest.current = { actions, round, accountIds: presence.present.map((person) => person.accountId) };

    useEffect(() => {
        if (!armed) {
            setDeadline(null);
            return undefined;
        }

        const revealAt = Date.now() + COUNTDOWN_MS;
        setDeadline(revealAt);
        setNow(Date.now());

        // Only drives the on-screen countdown.
        const ticker = setInterval(() => setNow(Date.now()), 250);

        const trigger = setTimeout(() => {
            const { actions: current, round: currentRound, accountIds } = latest.current;
            current.autoReveal(currentRound, accountIds);
        }, COUNTDOWN_MS + presence.rank * STAGGER_MS);

        return () => {
            clearInterval(ticker);
            clearTimeout(trigger);
        };
    }, [armed, round, presence.rank]);

    const secondsLeft = armed && deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

    return {
        waitingFor,
        everyoneVoted,
        // Counts down 3, 2, 1, then 0 ("revealing…") until the reveal lands;
        // null when no countdown is running.
        secondsLeft,
        held,
        hold: () => presence.holdAutoReveal(issueId, round),
    };
}
