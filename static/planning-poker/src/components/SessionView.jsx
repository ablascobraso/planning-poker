import React, { useEffect, useRef, useState } from 'react';

import Deck from './Deck';
import Participants from './Participants';
import Results from './Results';
import RoundHistory from './RoundHistory';
import SaveEstimate from './SaveEstimate';

const deckLabel = ({ label, cards }) => `${label} (${cards.join(', ')})`;

// Once a Jira space has used a deck, it's preselected and shown as a summary, so
// starting is one click; "Change" brings the picker back for this session. The
// "Lead this session" choice is remembered per space the same way.
// "Saves to Story points", or for a space that estimates several fields
// "Estimating Dev estimate, then QA estimate and Story points".
function targetsLine(targets) {
    const names = targets.map((target) => target.name);

    if (names.length === 0) {
        return null;
    }

    if (names.length === 1) {
        return `Saves to ${names[0]}`;
    }

    const rest = names.slice(1);
    const then = rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(', ')} and ${rest.at(-1)}`;
    return `Estimating ${names[0]}, then ${then}`;
}

function StartScreen({ scales, defaultScale, defaultLed, targets, busy, onStart }) {
    const remembered = scales.find((option) => option.id === defaultScale);
    const [scale, setScale] = useState(remembered?.id ?? scales[0]?.id ?? 'fibonacci');
    const [picking, setPicking] = useState(!remembered);
    const [led, setLed] = useState(defaultLed === true);

    return (
        <div className="empty">
            <h2 className="empty__title">Estimate this issue</h2>

            {picking ? (
                <div className="empty__actions">
                    <label className="field">
                        <span className="field__label">Deck</span>
                        <select
                            className="field__control"
                            value={scale}
                            onChange={(event) => setScale(event.target.value)}
                        >
                            {scales.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {deckLabel(option)}
                                </option>
                            ))}
                        </select>
                    </label>

                    <button
                        type="button"
                        className="btn btn--primary"
                        disabled={busy}
                        onClick={() => onStart(scale, led)}
                    >
                        Start session
                    </button>
                </div>
            ) : (
                <div className="empty__actions empty__actions--center">
                    <button
                        type="button"
                        className="btn btn--primary"
                        disabled={busy}
                        onClick={() => onStart(scale, led)}
                    >
                        Start session
                    </button>
                    <span className="deck-summary">
                        Deck: {deckLabel(remembered)}
                        <button type="button" className="link" onClick={() => setPicking(true)}>
                            Change
                        </button>
                    </span>
                </div>
            )}

            <label className="check">
                <input
                    type="checkbox"
                    checked={led}
                    onChange={(event) => setLed(event.target.checked)}
                />
                <span>
                    Lead this session
                    <span className="check__hint">
                        Only the person who starts the session can reveal the cards and move
                        on.
                    </span>
                </span>
            </label>

            {targetsLine(targets) && <p className="muted">{targetsLine(targets)}</p>}

            {picking && (
                <p className="muted">
                    The deck and lead choice you start with become this space's defaults.
                </p>
            )}
        </div>
    );
}

const MAX_NAMES = 3;

// "Marta", "Marta and Joan", "Marta, Joan, Pau and 2 others" - with "you" for
// the viewer, since being the one everybody waits for is worth noticing.
function namesOf(people, me) {
    const names = people.map((person) => (person.accountId === me ? 'you' : person.name));
    const shown = names.slice(0, MAX_NAMES);
    const others = names.length - shown.length;

    if (others > 0) {
        return `${shown.join(', ')} and ${others} other${others === 1 ? '' : 's'}`;
    }

    return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0];
}

// One line under the header while a round is open: the auto-reveal countdown,
// that everyone has voted (led sessions, which don't auto-reveal), that
// auto-reveal is on hold, or who we're still waiting for.
function RoundStatus({ session, autoReveal, me }) {
    const { secondsLeft, everyoneVoted, held, waitingFor, hold } = autoReveal;

    if (secondsLeft !== null) {
        return (
            <div className="round-status round-status--go" role="status">
                <span>
                    Everyone has voted.{' '}
                    <span aria-hidden="true">
                        {secondsLeft > 0 ? `Revealing in ${secondsLeft}s…` : 'Revealing…'}
                    </span>
                </span>
                {secondsLeft > 0 && (
                    <button type="button" className="link" onClick={hold}>
                        Wait
                    </button>
                )}
            </div>
        );
    }

    if (session.led && everyoneVoted) {
        return session.facilitator === me ? (
            <p className="round-status round-status--go" role="status">
                Everyone has voted. Reveal the cards when you're ready.
            </p>
        ) : (
            <p className="round-status muted" role="status">
                Everyone has voted. Waiting for {session.facilitatorName ?? 'the facilitator'} to
                reveal.
            </p>
        );
    }

    if (waitingFor.length > 0) {
        return (
            <p className="round-status muted" role="status">
                Waiting for {namesOf(waitingFor, me)}
            </p>
        );
    }

    if (held) {
        return (
            <p className="round-status muted" role="status">
                Auto-reveal is on hold for this round. Reveal the cards when you're ready.
            </p>
        );
    }

    return null;
}

// The whole voting experience for one issue, fed by useSession(), usePresence()
// and useAutoReveal(). Shared by the issue panel and the refinement page so both
// behave identically.
export default function SessionView({
    session,
    cards,
    scales,
    defaultScale,
    defaultLed,
    targets,
    votes,
    myVote,
    history,
    me,
    loading,
    busy,
    error,
    actions,
    dismissError,
    presence,
    autoReveal,
}) {
    // Remembers the last round this screen saw while it was still open, so the
    // results only celebrate a reveal that happened in front of the viewer -
    // not a round that was already revealed when they opened the issue.
    const openRound = useRef(null);
    const round = session?.round ?? null;
    const isOpen = Boolean(session) && !session.revealed;

    useEffect(() => {
        if (isOpen) {
            openRound.current = round;
        }
    }, [isOpen, round]);

    if (loading) {
        return <div className="shell shell--centered muted">Loading…</div>;
    }

    const revealed = session?.revealed ?? false;

    // In a led session only the facilitator gets the controls (the server
    // enforces the same rule). If they leave "Who's here", anyone else can take
    // over, so the session never gets stuck.
    const led = session?.led === true;
    const leading = led && session.facilitator === me;
    const inControl = !led || leading;
    const facilitatorHere = presence.present.some((person) => person.accountId === session?.facilitator);
    const canTakeOver = led && !leading && presence.ready && !facilitatorHere;

    // "3 of 5 voted" counts everyone here plus anyone who voted and left - except
    // people who are just watching and a facilitator who isn't voting. Without
    // working presence there's nobody to count against, so it's just "3 voted".
    const everyone = new Set([
        ...presence.present.filter((person) => !person.watching).map((person) => person.accountId),
        ...votes.map((vote) => vote.accountId),
    ]);
    if (led && !votes.some((vote) => vote.accountId === session.facilitator)) {
        everyone.delete(session.facilitator);
    }
    const votedLabel =
        presence.ready && everyone.size > votes.length
            ? `${votes.length} of ${everyone.size} voted`
            : `${votes.length} voted`;

    // The field this session's estimate is saved to, so everyone knows what
    // they're estimating ("Round 1 · 2 of 4 voted · Dev estimate").
    const targetName = session?.targets?.[session.targetIndex ?? 0]?.name ?? null;

    // Once this round's estimate is saved, another round of the same field is
    // rarely what the team wants - the next step is the next field, the next
    // issue, or End - so "New round" steps aside. A small "Re-estimate" link
    // next to the saved value covers the rare correction (see SaveEstimate).
    const roundSaved = Boolean(session?.saved && session.saved.round === session.round);

    const leadLabel = leading
        ? " · You're leading"
        : ` · Led by ${session?.facilitatorName ?? 'the facilitator'}`;

    return (
        <div className="shell">
            {error && (
                <div className="banner banner--error" role="alert">
                    <span>{error}</span>
                    <button type="button" className="banner__close" onClick={dismissError}>
                        ×
                    </button>
                </div>
            )}

            {!session ? (
                <StartScreen
                    scales={scales}
                    defaultScale={defaultScale}
                    defaultLed={defaultLed}
                    targets={targets ?? []}
                    busy={busy}
                    onStart={actions.start}
                />
            ) : (
                <>
                    <header className="header">
                        <div>
                            <h2 className="header__title">
                                {revealed ? 'Cards revealed!' : 'Pick your card!'}
                            </h2>
                            <p className="muted">
                                Round {session.round} · {revealed ? 'Revealed' : votedLabel}
                                {targetName && ` · ${targetName}`}
                                {led && leadLabel}
                            </p>
                        </div>

                        <div className="header__actions">
                            {inControl && !revealed && (
                                <button
                                    type="button"
                                    className="btn btn--primary"
                                    disabled={busy || votes.length === 0}
                                    onClick={actions.reveal}
                                >
                                    Reveal cards
                                </button>
                            )}
                            {inControl && revealed && !roundSaved && (
                                <button
                                    type="button"
                                    className="btn"
                                    disabled={busy}
                                    onClick={actions.revote}
                                >
                                    New round
                                </button>
                            )}
                            {inControl && (
                                <button
                                    type="button"
                                    className="btn"
                                    disabled={busy}
                                    onClick={actions.end}
                                >
                                    End
                                </button>
                            )}
                            {canTakeOver && (
                                <button
                                    type="button"
                                    className="btn"
                                    disabled={busy}
                                    title={`${session.facilitatorName ?? 'The facilitator'} has left this session`}
                                    onClick={actions.takeOver}
                                >
                                    Take over
                                </button>
                            )}
                        </div>
                    </header>

                    {!revealed && <RoundStatus session={session} autoReveal={autoReveal} me={me} />}

                    {!revealed && (
                        <section>
                            <div className="section-head">
                                <h3 className="section-title">Your card</h3>
                                {!presence.watching && (
                                    <button
                                        type="button"
                                        className="link link--subtle"
                                        title="Stay in the session without voting: nobody waits for you"
                                        onClick={() => presence.setWatching(true)}
                                    >
                                        Just watching
                                    </button>
                                )}
                            </div>
                            {presence.watching ? (
                                <p className="watching-note">
                                    You're just watching, so nobody waits for your vote.{' '}
                                    <button
                                        type="button"
                                        className="link"
                                        onClick={() => presence.setWatching(false)}
                                    >
                                        Vote instead
                                    </button>
                                </p>
                            ) : (
                                <Deck
                                    cards={cards}
                                    myVote={myVote}
                                    disabled={busy}
                                    onPick={actions.vote}
                                />
                            )}
                        </section>
                    )}

                    <section>
                        <h3 className="section-title">
                            {revealed ? 'Votes' : presence.ready ? "Who's here" : 'Voted so far'}
                        </h3>
                        <Participants
                            votes={votes}
                            present={presence.present}
                            presenceReady={presence.ready}
                            me={me}
                            facilitator={led ? session.facilitator : null}
                            revealed={revealed}
                        />
                    </section>

                    {revealed && (
                        <Results votes={votes} justRevealed={openRound.current === session.round}>
                            <SaveEstimate
                                session={session}
                                votes={votes}
                                inControl={inControl}
                                busy={busy}
                                actions={actions}
                            />
                        </Results>
                    )}

                    <RoundHistory history={history} currentRound={session.round} />
                </>
            )}
        </div>
    );
}
