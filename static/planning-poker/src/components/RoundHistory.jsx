import React from 'react';

import { summarise } from './Results';

// How the estimates moved: one line per earlier revealed round of this session,
// oldest first, e.g. "Round 1 · 3 ×1 · 5 ×2 · 8 ×1 · Discuss". Hovering a card
// shows who played it. The current round isn't repeated here - while voting it
// has no cards yet, and once revealed it's shown in full by Results.
//
// Teams rarely need it, so it starts collapsed behind a single "Earlier rounds"
// line. <details> gives the open/close behaviour, keyboard support and
// screen-reader semantics for free, and keeps itself open across re-renders
// until the view moves to another issue.
export default function RoundHistory({ history, currentRound }) {
    const earlier = history.filter((entry) => entry.round < currentRound);

    if (earlier.length === 0) {
        return null;
    }

    return (
        <details className="history">
            <summary className="history__toggle">Earlier rounds ({earlier.length})</summary>
            <ol className="history__rounds">
                {earlier.map((entry) => {
                    const { distribution, average, consensus } = summarise(entry.votes);

                    return (
                        <li key={entry.round} className="history__round">
                            <span className="history__label">Round {entry.round}</span>
                            <span className="history__cards">
                                {distribution.map(({ card, count, names }) => (
                                    <span key={card} className="history__card" title={names.join(', ')}>
                                        {card}
                                        <span className="history__count">×{count}</span>
                                    </span>
                                ))}
                            </span>
                            <span className="history__outcome">
                                {consensus ? (
                                    <span className="pill pill--ok">Consensus</span>
                                ) : (
                                    <span className="pill">Discuss</span>
                                )}
                                {average !== null && <span className="muted">avg {average}</span>}
                            </span>
                        </li>
                    );
                })}
            </ol>
        </details>
    );
}
