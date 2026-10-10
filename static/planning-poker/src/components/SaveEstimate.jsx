import React, { useMemo, useState } from 'react';

import { summarise } from './Results';

// Cards that stand for a number can be saved to a Jira number field; "?", "☕"
// and T-shirt sizes can't.
const isNumberCard = (card) => card === '½' || Number.isFinite(Number(card));

// Saving the revealed round's estimate to the issue, at the bottom of the
// results. The session estimates one of the space's estimation fields at a
// time (see estimation.js on the backend):
// - before saving: one button, "Save 5 to Story points". The most-voted number
//   is preselected; when votes differ, the other numbers played sit beside it
//   as one-click alternatives.
// - after saving: "Saved 5 to Dev estimate", and if the space estimates more
//   fields, "Next: QA estimate", which starts a fresh round for that field.
// Only those who can reveal (inControl) see the buttons; in a led session the
// others are told the facilitator will save.
export default function SaveEstimate({ session, votes, inControl, busy, actions }) {
    const targets = session.targets ?? [];
    const index = session.targetIndex ?? 0;
    const target = targets[index];
    const next = targets[index + 1];
    const saved = session.saved?.round === session.round ? session.saved : null;

    // Number cards played this round, most votes first.
    const candidates = useMemo(
        () => summarise(votes).distribution.filter(({ card }) => isNumberCard(card)),
        [votes]
    );
    const [choice, setChoice] = useState(null);
    const selected = candidates.some(({ card }) => card === choice) ? choice : candidates[0]?.card;

    // The space has no field to save to (no story points field, none chosen).
    if (!target) {
        return null;
    }

    if (saved) {
        return (
            <div className="save save--done" role="status">
                <span className="save__done">
                    ✓ Saved {saved.card} to {saved.fieldName}
                </span>
                {next && inControl && (
                    <button type="button" className="btn btn--primary" disabled={busy} onClick={actions.nextTarget}>
                        Next: {next.name} →
                    </button>
                )}
                {!next && targets.length > 1 && <span className="muted">All estimates saved</span>}
            </div>
        );
    }

    if (candidates.length === 0) {
        return <p className="save__note">Only number cards can be saved to {target.name}.</p>;
    }

    if (!inControl) {
        return (
            <p className="save__note">
                {session.facilitatorName ?? 'The facilitator'} will save the estimate to {target.name}.
            </p>
        );
    }

    return (
        <div className="save">
            {candidates.length > 1 && (
                <div className="save__options" role="radiogroup" aria-label="Estimate to save">
                    {candidates.map(({ card, count }) => (
                        <button
                            key={card}
                            type="button"
                            role="radio"
                            aria-checked={card === selected}
                            className={`save__option${card === selected ? ' save__option--selected' : ''}`}
                            title={`${count} vote${count === 1 ? '' : 's'}`}
                            onClick={() => setChoice(card)}
                        >
                            {card}
                        </button>
                    ))}
                </div>
            )}
            <button
                type="button"
                className="btn btn--primary"
                disabled={busy || !selected}
                onClick={() => actions.saveEstimate(selected)}
            >
                Save {selected} to {target.name}
            </button>
        </div>
    );
}
