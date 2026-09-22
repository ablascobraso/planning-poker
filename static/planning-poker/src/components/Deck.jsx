import React from 'react';

export default function Deck({ cards, myVote, disabled, onPick }) {
    return (
        <div className="deck" role="group" aria-label="Estimation cards">
            {cards.map((card) => {
                const selected = card === myVote;
                return (
                    <button
                        key={card}
                        type="button"
                        className={`card${selected ? ' card--selected' : ''}`}
                        aria-pressed={selected}
                        disabled={disabled}
                        onClick={() => onPick(card)}
                    >
                        {card}
                    </button>
                );
            })}
        </div>
    );
}
