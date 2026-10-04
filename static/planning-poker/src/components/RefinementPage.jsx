import React, { useCallback, useEffect, useRef, useState } from 'react';
import { realtime, router } from '@forge/bridge';

import * as api from '../lib/api';
import { useAutoReveal } from '../lib/useAutoReveal';
import { usePresence } from '../lib/usePresence';
import { CHANNEL, useSession } from '../lib/useSession';
import IssuePicker from './IssuePicker';
import SessionView from './SessionView';

function FocusedSession({ issueId, presence }) {
    const state = useSession(issueId);
    const autoReveal = useAutoReveal(state, presence, issueId);

    return <SessionView {...state} presence={presence} autoReveal={autoReveal} />;
}

const CONFIRM_WINDOW_MS = 3000;

// A project page for refinement meetings. The team builds a hand-picked queue of
// issues and works down it, estimating each one in its own independent session.
// The queue and the issue being estimated are shared, so everyone follows along.
export default function RefinementPage() {
    const [queue, setQueue] = useState([]);
    const [focusId, setFocusId] = useState(null);
    const [picking, setPicking] = useState(false);
    const [confirmingClear, setConfirmingClear] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const clearTimer = useRef(null);

    // Presence belongs to the page, not to each issue: whoever has the page open
    // is in the meeting. Moving to the next issue therefore doesn't make the
    // whole room leave and re-announce itself, which in a big meeting could brush
    // against Forge's realtime rate limit.
    const presence = usePresence(true);

    const load = useCallback(async () => {
        try {
            const data = await api.getRefinement();
            setQueue(data.queue);
            setFocusId(data.focusIssueId);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        const onEvent = (payload) => {
            if (payload?.type === 'focus') {
                setFocusId(payload.issueId);
            }
            if (payload?.type === 'queue') {
                load();
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
            clearTimeout(clearTimer.current);
        };
    }, [load]);

    // Wraps queue/focus actions with the same error handling.
    const attempt = async (action) => {
        try {
            const result = await action();
            setError(null);
            return result;
        } catch (err) {
            setError(err.message);
            return null;
        }
    };

    const focusOn = async (issueId) => {
        const previous = focusId;
        setFocusId(issueId);
        const result = await attempt(() => api.setFocus(issueId));
        if (!result) {
            setFocusId(previous);
        }
    };

    const addIssues = async (issueIds) => {
        const result = await attempt(() => api.addToQueue(issueIds));
        if (result) {
            setQueue(result.queue);
            setPicking(false);
            // If nothing in the queue was being estimated - a fresh page, or the
            // focused issue has since been removed from the queue - start with
            // the first issue in it.
            const focusQueued = result.queue.some((issue) => issue.id === focusId);
            if (!focusQueued && result.queue.length > 0) {
                focusOn(result.queue[0].id);
            }
        }
    };

    const removeIssue = async (issueId) => {
        const result = await attempt(() => api.removeFromQueue(issueId));
        if (result) {
            setQueue(result.queue);
        }
    };

    // Clearing wipes the team's shared list, so it takes a second click.
    const clearQueue = async () => {
        if (!confirmingClear) {
            setConfirmingClear(true);
            clearTimer.current = setTimeout(() => setConfirmingClear(false), CONFIRM_WINDOW_MS);
            return;
        }
        clearTimeout(clearTimer.current);
        setConfirmingClear(false);
        const result = await attempt(() => api.clearQueue());
        if (result) {
            setQueue(result.queue);
        }
    };

    if (loading) {
        return <div className="shell shell--centered muted">Loading queue…</div>;
    }

    // The shared focus is stored apart from the queue, so it can point at an issue
    // that has since been removed (or that this viewer can't see). Only an issue
    // that's actually in the queue counts as the one being estimated.
    const index = queue.findIndex((issue) => issue.id === focusId);
    const current = index >= 0 ? queue[index] : null;
    const next = index >= 0 ? queue[index + 1] : null;

    const renderMain = () => {
        if (picking) {
            return (
                <IssuePicker
                    queuedIds={queue.map((issue) => issue.id)}
                    onAdd={addIssues}
                    onClose={() => setPicking(false)}
                />
            );
        }

        if (queue.length === 0) {
            return (
                <div className="empty">
                    <h2 className="empty__title">Build your estimation queue</h2>
                    <p className="muted">
                        Add the issues you want to estimate in this meeting. Everyone on this
                        page works through them together, one at a time.
                    </p>
                    <button type="button" className="btn btn--primary" onClick={() => setPicking(true)}>
                        + Add issues
                    </button>
                </div>
            );
        }

        if (!current) {
            return (
                <div className="empty">
                    <h2 className="empty__title">Pick an issue to start</h2>
                    <p className="muted">Choose an issue from the queue to estimate it together.</p>
                </div>
            );
        }

        return (
            <>
                <div className="current">
                    <div className="current__info">
                        <button
                            type="button"
                            className="current__key"
                            onClick={() => router.open(`/browse/${current.key}`)}
                        >
                            {current.key}
                        </button>
                        <h2 className="current__summary">{current.summary}</h2>
                    </div>
                    {next && (
                        <button type="button" className="btn" onClick={() => focusOn(next.id)}>
                            Next issue →
                        </button>
                    )}
                </div>
                <FocusedSession key={focusId} issueId={focusId} presence={presence} />
            </>
        );
    };

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
                <div className="refinement__head">
                    <h2 className="section-title">Estimation queue ({queue.length})</h2>
                    <button type="button" className="btn" onClick={() => setPicking(true)}>
                        + Add issues
                    </button>
                </div>

                {queue.length === 0 ? (
                    <p className="muted">No issues yet.</p>
                ) : (
                    <ul className="issues">
                        {queue.map((issue) => (
                            <li key={issue.id} className="queue-item">
                                <button
                                    type="button"
                                    className={`issue${issue.id === focusId ? ' issue--active' : ''}`}
                                    aria-current={issue.id === focusId}
                                    onClick={() => {
                                        setPicking(false);
                                        focusOn(issue.id);
                                    }}
                                >
                                    <span className="issue__key">{issue.key}</span>
                                    <span className="issue__summary">{issue.summary}</span>
                                    <span className="issue__status">{issue.status}</span>
                                </button>
                                <button
                                    type="button"
                                    className="queue-item__remove"
                                    aria-label={`Remove ${issue.key} from the queue`}
                                    title="Remove from queue"
                                    onClick={() => removeIssue(issue.id)}
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {queue.length > 0 && (
                    <button type="button" className="link refinement__clear" onClick={clearQueue}>
                        {confirmingClear ? 'Click again to clear the queue' : 'Clear queue'}
                    </button>
                )}
            </aside>

            <main className="refinement__session">{renderMain()}</main>
        </div>
    );
}
