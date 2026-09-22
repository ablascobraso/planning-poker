import React, { useMemo, useState } from 'react';

function summarise(votes) {
    const tally = new Map();

    for (const { card } of votes) {
        tally.set(card, (tally.get(card) ?? 0) + 1);
    }

    const distribution = [...tally.entries()]
        .map(([card, count]) => ({ card, count }))
        .sort((a, b) => b.count - a.count || a.card.localeCompare(b.card));

    const numbers = votes.map(({ card }) => Number(card)).filter(Number.isFinite);
    const average = numbers.length
        ? Math.round((numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 10) / 10
        : null;

    return {
        distribution,
        average,
        consensus: distribution.length === 1,
        numericChoices: [...new Set(numbers)].sort((a, b) => a - b),
    };
}

export default function Results({ votes, busy, estimate, onSave }) {
    const { distribution, average, consensus, numericChoices } = useMemo(
        () => summarise(votes),
        [votes]
    );
    const [custom, setCustom] = useState('');

    return (
        <div className="results">
            <div className="results__head">
                <h3 className="section-title">Results</h3>
                {consensus ? (
                    <span className="pill pill--ok">Consensus</span>
                ) : (
                    <span className="pill">Discuss</span>
                )}
            </div>

            <div className="distribution">
                {distribution.map(({ card, count }) => (
                    <div key={card} className="distribution__item">
                        <span className="distribution__card">{card}</span>
                        <span className="distribution__count">
                            {count} {count === 1 ? 'vote' : 'votes'}
                        </span>
                    </div>
                ))}
            </div>

            {average !== null && <p className="muted">Average of numeric votes: {average}</p>}

            <div className="save">
                <h3 className="section-title">Save estimate</h3>

                {numericChoices.length === 0 && !custom && (
                    <p className="muted">
                        Story points need a number. Enter one below to save it to the issue.
                    </p>
                )}

                <div className="save__row">
                    {numericChoices.map((value) => (
                        <button
                            key={value}
                            type="button"
                            className="chip"
                            disabled={busy}
                            onClick={() => onSave(value)}
                        >
                            {value}
                        </button>
                    ))}

                    <input
                        className="save__input"
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="Other"
                        value={custom}
                        disabled={busy}
                        onChange={(event) => setCustom(event.target.value)}
                    />
                    <button
                        type="button"
                        className="btn btn--primary"
                        disabled={busy || custom === ''}
                        onClick={() => onSave(Number(custom))}
                    >
                        Save
                    </button>
                </div>

                {estimate !== null && (
                    <p className="saved">Saved {estimate} story points to this issue.</p>
                )}
            </div>
        </div>
    );
}
