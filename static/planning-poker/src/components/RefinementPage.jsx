import React, { useEffect, useState } from 'react';
import { realtime, router } from '@forge/bridge';

import * as api from '../lib/api';
import { CHANNEL, useSession } from '../lib/useSession';
import SessionView from './SessionView';

function FocusedSession({ issueId }) {
    return <SessionView {...useSession(issueId)} />;
}

// A project page for refinement meetings: the team works down a list of issues,
// estimating each one in its own independent session. The issue being estimated
// is shared, so when anyone moves on, everyone on the page moves with them.
export default function RefinementPage() {
    const [issues, setIssues] = useState([]);
    const [focusId, setFocusId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        api.getRefinement()
            .then((data) => {
                setIssues(data.issues);
                setFocusId(data.focusIssueId);
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        const onEvent = (payload) => {
            if (payload?.type === 'focus') {
                setFocusId(payload.issueId);
            }
        };

        let active = true;
        let subscription;

        realtime
            .subscribe(CHANNEL, onEvent)
            .then((sub) => {
                subscription = sub;
                if (!active) {
                    sub.unsubscribe();
                }
            })
            .catch((err) => console.error('realtime subscribe failed', err));

        return () => {
            active = false;
            subscription?.unsubscribe();
        };
    }, []);

    const focusOn = async (issueId) => {
        const previous = focusId;
        setFocusId(issueId);
        try {
            await api.setFocus(issueId);
            setError(null);
        } catch (err) {
            setFocusId(previous);
            setError(err.message);
        }
    };

    if (loading) {
        return <div className="shell shell--centered muted">Loading issues…</div>;
    }

    const index = issues.findIndex((issue) => issue.id === focusId);
    const current = index >= 0 ? issues[index] : null;
    const next = index >= 0 ? issues[index + 1] : null;

    return (
        <div className="refinement">
            {error && (
                <div className="banner banner--error refinement__error" role="alert">
                    <span>{error}</span>
                    <button type="button" className="banner__close" onClick={() => setError(null)}>
                        ×
                    </button>
                </div>
            )}

            <aside className="refinement__list">
                <h2 className="section-title">Issues to estimate ({issues.length})</h2>

                {issues.length === 0 ? (
                    <p className="muted">No open issues in this project.</p>
                ) : (
                    <ul className="issues">
                        {issues.map((issue) => (
                            <li key={issue.id}>
                                <button
                                    type="button"
                                    className={`issue${issue.id === focusId ? ' issue--active' : ''}`}
                                    aria-current={issue.id === focusId}
                                    onClick={() => focusOn(issue.id)}
                                >
                                    <span className="issue__key">{issue.key}</span>
                                    <span className="issue__summary">{issue.summary}</span>
                                    <span className="issue__status">{issue.status}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </aside>

            <main className="refinement__session">
                {focusId ? (
                    <>
                        <div className="current">
                            <div className="current__info">
                                {current && (
                                    <button
                                        type="button"
                                        className="current__key"
                                        onClick={() => router.open(`/browse/${current.key}`)}
                                    >
                                        {current.key}
                                    </button>
                                )}
                                <h2 className="current__summary">
                                    {current?.summary ?? 'This issue is no longer in the list'}
                                </h2>
                            </div>
                            {next && (
                                <button type="button" className="btn" onClick={() => focusOn(next.id)}>
                                    Next issue →
                                </button>
                            )}
                        </div>
                        <FocusedSession key={focusId} issueId={focusId} />
                    </>
                ) : (
                    <div className="empty">
                        <h2 className="empty__title">Pick an issue to start</h2>
                        <p className="muted">
                            Choose an issue from the list. Everyone on this page will
                            estimate it together, then move on to the next one.
                        </p>
                    </div>
                )}
            </main>
        </div>
    );
}
