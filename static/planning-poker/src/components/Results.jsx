import React, { useMemo } from 'react';

const cardValue = (card) => (card === '½' ? 0.5 : Number(card));

function summarise(votes) {
    const tally = new Map();

    for (const { card } of votes) {
        tally.set(card, (tally.get(card) ?? 0) + 1);
    }

    const distribution = [...tally.entries()]
        .map(([card, count]) => ({ card, count }))
        .sort((a, b) => b.count - a.count || a.card.localeCompare(b.card));

    const numbers = votes.map(({ card }) => cardValue(card)).filter(Number.isFinite);
    const average = numbers.length
        ? Math.round((numbers.reduce((sum, n) => sum + n, 0) / numbers.length) * 10) / 10
        : null;

    return {
        distribution,
        average,
        consensus: distribution.length === 1,
    };
}

export default function Results({ votes }) {
    const { distribution, average, consensus } = useMemo(() => summarise(votes), [votes]);

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
        </div>
    );
}
