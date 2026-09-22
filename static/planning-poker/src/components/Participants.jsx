import React from 'react';

function Avatar({ voter }) {
    if (voter.avatar) {
        return <img className="voter__avatar" src={voter.avatar} alt="" />;
    }

    const initial = (voter.name ?? '?').trim().charAt(0).toUpperCase();
    return <span className="voter__avatar voter__avatar--fallback">{initial}</span>;
}

export default function Participants({ votes, me, revealed }) {
    if (votes.length === 0) {
        return <p className="muted">No votes yet.</p>;
    }

    return (
        <ul className="voters">
            {votes.map((voter) => (
                <li key={voter.accountId} className="voter">
                    <Avatar voter={voter} />
                    <span className="voter__name">
                        {voter.name}
                        {voter.accountId === me ? ' (you)' : ''}
                    </span>
                    <span className={`voter__card${revealed ? '' : ' voter__card--hidden'}`}>
                        {revealed ? voter.card : '✓'}
                    </span>
                </li>
            ))}
        </ul>
    );
}
