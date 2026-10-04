import React from 'react';

function Avatar({ person }) {
    if (person.avatar) {
        return <img className="voter__avatar" src={person.avatar} alt="" />;
    }

    const initial = (person.name ?? '?').trim().charAt(0).toUpperCase();
    return <span className="voter__avatar voter__avatar--fallback">{initial}</span>;
}

// While a round is open, everyone here is listed - whether or not they've voted -
// plus anyone who voted and then left. Names are sorted so every viewer sees the
// same order, and rows don't jump around as people vote.
function openRoundRows(votes, present, presenceReady) {
    const rows = new Map();

    for (const person of present) {
        rows.set(person.accountId, { ...person, voted: false, away: false });
    }

    for (const vote of votes) {
        const here = rows.get(vote.accountId);
        rows.set(vote.accountId, {
            ...(here ?? vote),
            voted: true,
            // Only claim someone left once presence is actually working.
            away: presenceReady && !here,
        });
    }

    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function Status({ row, revealed, isFacilitator }) {
    if (revealed) {
        return <span className="voter__card">{row.card}</span>;
    }

    if (row.voted) {
        return (
            <span className="voter__card voter__card--hidden" title="Voted">
                ✓
            </span>
        );
    }

    // A facilitator runs the meeting and may not vote, so nobody waits for them.
    if (isFacilitator) {
        return <span className="voter__card" />;
    }

    return (
        <span className="voter__card voter__card--waiting" title="Hasn't voted yet">
            …
        </span>
    );
}

// facilitator: the account leading the session, or null when it isn't led.
export default function Participants({ votes, present, presenceReady, me, facilitator, revealed }) {
    // Once revealed, the votes are what matter, in the order they were cast.
    const rows = revealed ? votes : openRoundRows(votes, present, presenceReady);

    if (rows.length === 0) {
        return <p className="muted">No votes yet.</p>;
    }

    return (
        <ul className="voters">
            {rows.map((row) => (
                <li
                    key={row.accountId}
                    className={[
                        'voter',
                        // While the round is open, voters stand out from those
                        // still choosing. After the reveal everyone listed voted.
                        !revealed && row.voted ? 'voter--voted' : '',
                        row.away ? 'voter--away' : '',
                    ]
                        .filter(Boolean)
                        .join(' ')}
                    title={row.away ? 'Voted, then left this session' : undefined}
                >
                    <Avatar person={row} />
                    <span className="voter__name">
                        {row.name}
                        {row.accountId === me ? ' (you)' : ''}
                        {row.accountId === facilitator && <span className="lead-tag">Leading</span>}
                    </span>
                    <Status
                        row={row}
                        revealed={revealed}
                        isFacilitator={row.accountId === facilitator}
                    />
                </li>
            ))}
        </ul>
    );
}
