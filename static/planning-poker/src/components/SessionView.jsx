import React, { useState } from 'react';

import Deck from './Deck';
import Participants from './Participants';
import Results from './Results';

function StartScreen({ scales, busy, onStart }) {
    const [scale, setScale] = useState(scales[0]?.id ?? 'fibonacci');

    return (
        <div className="empty">
            <h2 className="empty__title">Estimate this issue as a team</h2>
            <p className="muted">
                Everyone votes in private. Nobody sees a card until you reveal them.
            </p>

            <div className="empty__actions">
                <label className="field">
                    <span className="field__label">Deck</span>
                    <select
                        className="field__control"
                        value={scale}
                        onChange={(event) => setScale(event.target.value)}
                    >
                        {scales.map(({ id, label, cards }) => (
                            <option key={id} value={id}>
                                {label} ({cards.join(', ')})
                            </option>
                        ))}
                    </select>
                </label>

                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => onStart(scale)}
                >
                    Start session
                </button>
            </div>
        </div>
    );
}

// The whole voting experience for one issue, fed by useSession(). Shared by the
// issue panel and the refinement page so both behave identically.
export default function SessionView({
    session,
    cards,
    scales,
    votes,
    myVote,
    me,
    loading,
    busy,
    error,
    actions,
    dismissError,
}) {
    if (loading) {
        return <div className="shell shell--centered muted">Loading…</div>;
    }

    const revealed = session?.revealed ?? false;

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
                <StartScreen scales={scales} busy={busy} onStart={actions.start} />
            ) : (
                <>
                    <header className="header">
                        <div>
                            <h2 className="header__title">
                                {revealed ? 'Cards revealed!' : 'Pick your card!'}
                            </h2>
                            <p className="muted">
                                Round {session.round} ·{' '}
                                {revealed ? 'Revealed' : `${votes.length} voted`}
                            </p>
                        </div>

                        <div className="header__actions">
                            {!revealed && (
                                <button
                                    type="button"
                                    className="btn btn--primary"
                                    disabled={busy || votes.length === 0}
                                    onClick={actions.reveal}
                                >
                                    Reveal cards
                                </button>
                            )}
                            {revealed && (
                                <button
                                    type="button"
                                    className="btn"
                                    disabled={busy}
                                    onClick={actions.revote}
                                >
                                    New round
                                </button>
                            )}
                            <button type="button" className="btn" disabled={busy} onClick={actions.end}>
                                End
                            </button>
                        </div>
                    </header>

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
                            {revealed ? 'Votes' : 'Voted so far'}
                        </h3>
                        <Participants votes={votes} me={me} revealed={revealed} />
                    </section>

                    {revealed && <Results votes={votes} />}
                </>
            )}
        </div>
    );
}
