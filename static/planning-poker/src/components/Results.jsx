import React, { useMemo, useRef } from 'react';

import { useConsensusConfetti } from '../lib/useConsensusConfetti';

const cardValue = (card) => (card === '½' ? 0.5 : Number(card));

// Counts the cards of one round: which cards, how often, and who played each.
// Shared with RoundHistory so earlier rounds read exactly like the current one.
export function summarise(votes) {
    const tally = new Map();

    for (const { card, name } of votes) {
        const entry = tally.get(card) ?? { count: 0, names: [] };
        entry.count += 1;
        entry.names.push(name ?? 'Unknown user');
        tally.set(card, entry);
    }

    const distribution = [...tally.entries()]
        .map(([card, { count, names }]) => ({ card, count, names }))
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

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The winning value drawn as a playing card in Atlassian blue, with the value
// repeated small in two corners like a real card. It flips in on reveal; ties
// show each tied card, flipping in one after another.
function ResultCard({ card, small, order }) {
    return (
        <span
            className={`result-card${small ? ' result-card--small' : ''}`}
            style={{ animationDelay: `${order * 90}ms` }}
        >
            <span className="result-card__pip result-card__pip--top" aria-hidden="true">
                {card}
            </span>
            {card}
            <span className="result-card__pip result-card__pip--bottom" aria-hidden="true">
                {card}
            </span>
        </span>
    );
}

// Celebrating takes at least two people agreeing - one voter agreeing with
// themselves isn't news.
const MIN_VOTES_TO_CELEBRATE = 2;

// What a revealed round came to, highlighted in Jira's brand blue: the winning
// card up front, a one-line verdict, and - when the votes differ - a bar per
// card showing its share. Hovering a bar shows who played that card.
// justRevealed: this screen saw the reveal happen (see SessionView), so a
// consensus earns a little confetti from the result card.
export default function Results({ votes, justRevealed = false }) {
    const { distribution, average, consensus } = useMemo(() => summarise(votes), [votes]);
    const cardsRef = useRef(null);

    useConsensusConfetti(
        justRevealed && consensus && votes.length >= MIN_VOTES_TO_CELEBRATE,
        cardsRef
    );

    if (distribution.length === 0) {
        return null;
    }

    const topCount = distribution[0].count;
    const leaders = distribution.filter(({ count }) => count === topCount);
    const tied = leaders.length > 1;
    const total = votes.length;
    const averageText = average !== null ? ` · average ${average}` : '';

    let headline;
    let detail;
    if (consensus) {
        headline = 'Everyone agrees';
        detail = plural(total, 'vote');
    } else if (tied) {
        headline = 'Tied';
        detail = `${plural(topCount, 'vote')} each${averageText}`;
    } else {
        headline = 'Most votes';
        detail = `${topCount} of ${plural(total, 'vote')}${averageText}`;
    }

    return (
        <section className="results" aria-label="Results">
            <div className="results__head">
                <h3 className="section-title">Results</h3>
                {consensus ? (
                    <span className="pill pill--ok">Consensus</span>
                ) : (
                    <span className="pill">Discuss</span>
                )}
            </div>

            <div className="results__hero">
                <div className="results__cards" ref={cardsRef}>
                    {leaders.map(({ card }, order) => (
                        <ResultCard key={card} card={card} small={tied} order={order} />
                    ))}
                </div>
                <div className="results__caption">
                    <span className="results__headline">{headline}</span>
                    <span className="results__detail">{detail}</span>
                </div>
            </div>

            {!consensus && (
                <ul className="results__bars">
                    {distribution.map(({ card, count, names }) => (
                        <li
                            key={card}
                            className={`results__bar${count === topCount ? ' results__bar--top' : ''}`}
                            title={names.join(', ')}
                        >
                            <span className="results__bar-card">{card}</span>
                            <span className="results__bar-track">
                                <span
                                    className="results__bar-fill"
                                    style={{ width: `${(count / total) * 100}%` }}
                                />
                            </span>
                            <span className="results__bar-count">{plural(count, 'vote')}</span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
