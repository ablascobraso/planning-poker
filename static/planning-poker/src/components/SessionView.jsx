import React, { useState } from 'react';

import Deck from './Deck';
import Participants from './Participants';
import Results from './Results';
import RoundHistory from './RoundHistory';

const deckLabel = ({ label, cards }) => `${label} (${cards.join(', ')})`;

// Once a Jira space has used a deck, it's preselected and shown as a summary, so
// starting is one click; "Change" brings the picker back for this session. The
// "Lead this session" choice is remembered per space the same way.
function StartScreen({ scales, defaultScale, defaultLed, busy, onStart }) {
    const remembered = scales.find((option) => option.id === defaultScale);
    const [scale, setScale] = useState(remembered?.id ?? scales[0]?.id ?? 'fibonacci');
    const [picking, setPicking] = useState(!remembered);
    const [led, setLed] = useState(defaultLed === true);

    return (
        <div className="empty">
            <h2 className="empty__title">Estimate this issue as a team</h2>
            <p className="muted">
                Everyone votes in private. Nobody sees a card until you reveal them.
            </p>

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
    // a facilitator who isn't voting. Without working presence there's nobody to
    // count against, so it's just "3 voted".
    const everyone = new Set([
        ...presence.present.map((person) => person.accountId),
        ...votes.map((vote) => vote.accountId),
    ]);
    if (led && !votes.some((vote) => vote.accountId === session.facilitator)) {
        everyone.delete(session.facilitator);
    }
    const votedLabel =
        presence.ready && everyone.size > votes.length
            ? `${votes.length} of ${everyone.size} voted`
            : `${votes.length} voted`;

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
                            {inControl && revealed && (
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
                            <h3 className="section-title">Your card</h3>
                            <Deck
                                cards={cards}
                                myVote={myVote}
                                disabled={busy}
                                onPick={actions.vote}
                            />
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

                    {revealed && <Results votes={votes} />}

                    <RoundHistory history={history} currentRound={session.round} />
                </>
            )}
        </div>
    );
}
