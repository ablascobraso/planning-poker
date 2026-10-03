import React, { useEffect, useRef, useState } from 'react';

import * as api from '../lib/api';

const CHIPS = [
    { id: 'unestimated', label: 'Unestimated' },
    { id: 'recent', label: 'Recently viewed' },
    { id: 'created', label: 'Recently created' },
    { id: 'backlog', label: 'Backlog' },
    { id: 'currentSprint', label: 'Current sprint' },
    { id: 'nextSprint', label: 'Next sprint' },
];

const SEARCH_DELAY_MS = 300;

// Lets the facilitator add issues to the estimation queue: search by key or
// words, narrow with a quick chip, or paste a batch of keys, then tick and add
// several at once. Searches are debounced to keep resolver invocations down.
export default function IssuePicker({ queuedIds, onAdd, onClose }) {
    const [text, setText] = useState('');
    const [chip, setChip] = useState(CHIPS[0].id);
    const [results, setResults] = useState([]);
    const [nextPageToken, setNextPageToken] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [adding, setAdding] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);

        const timer = setTimeout(() => {
            api.searchIssues(text, chip)
                .then(({ results: found, nextPageToken: token }) => {
                    if (!cancelled) {
                        setResults(found);
                        setNextPageToken(token);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setResults([]);
                        setNextPageToken(null);
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setLoading(false);
                    }
                });
        }, SEARCH_DELAY_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [text, chip]);

    const showMore = async () => {
        setLoadingMore(true);
        try {
            const page = await api.searchIssues(text, chip, nextPageToken);
            setResults((previous) => {
                const seen = new Set(previous.map((issue) => issue.id));
                return [...previous, ...page.results.filter((issue) => !seen.has(issue.id))];
            });
            setNextPageToken(page.nextPageToken);
        } catch {
            setNextPageToken(null);
        } finally {
            setLoadingMore(false);
        }
    };

    const addable = results.filter((issue) => !queuedIds.includes(issue.id));

    const toggle = (issueId) => {
        setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(issueId)) {
                next.delete(issueId);
            } else {
                next.add(issueId);
            }
            return next;
        });
    };

    const selectAll = () => {
        setSelected((previous) => new Set([...previous, ...addable.map((issue) => issue.id)]));
    };

    const add = async () => {
        setAdding(true);
        await onAdd([...selected]);
        setAdding(false);
    };

    return (
        <section
            className="picker"
            aria-label="Add issues to the estimation queue"
            onKeyDown={(event) => event.key === 'Escape' && onClose()}
        >
            <div className="picker__head">
                <h2 className="current__summary">Add issues</h2>
                <button type="button" className="banner__close" aria-label="Close" onClick={onClose}>
                    ×
                </button>
            </div>

            <input
                ref={inputRef}
                className="field__control picker__search"
                type="search"
                placeholder="Search by key or words, or paste keys: PPT-12, PPT-15"
                aria-label="Search issues"
                value={text}
                onChange={(event) => setText(event.target.value)}
            />

            <div className="chips" role="group" aria-label="Quick filters">
                {CHIPS.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        className={`chip-toggle${chip === id ? ' chip-toggle--active' : ''}`}
                        aria-pressed={chip === id}
                        onClick={() => setChip(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="picker__results">
                {loading && <p className="muted">Searching…</p>}

                {!loading && results.length === 0 && (
                    <p className="muted">No matching open issues in this space.</p>
                )}

                {!loading &&
                    results.map((issue) => {
                        const queued = queuedIds.includes(issue.id);
                        return (
                            <label
                                key={issue.id}
                                className={`picker__row${queued ? ' picker__row--queued' : ''}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={queued || selected.has(issue.id)}
                                    disabled={queued}
                                    onChange={() => toggle(issue.id)}
                                />
                                <span className="issue__key">{issue.key}</span>
                                <span className="picker__summary">{issue.summary}</span>
                                <span className="issue__status">{queued ? 'In queue' : issue.status}</span>
                            </label>
                        );
                    })}

                {!loading && nextPageToken && (
                    <button
                        type="button"
                        className="link picker__more"
                        disabled={loadingMore}
                        onClick={showMore}
                    >
                        {loadingMore ? 'Loading…' : 'Show more'}
                    </button>
                )}
            </div>

            <div className="picker__footer">
                <button
                    type="button"
                    className="link"
                    disabled={addable.length === 0}
                    onClick={selectAll}
                >
                    Select all
                </button>
                <div className="picker__actions">
                    <button type="button" className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn--primary"
                        disabled={selected.size === 0 || adding}
                        onClick={add}
                    >
                        {selected.size === 0
                            ? 'Add issues'
                            : selected.size === 1
                              ? 'Add 1 issue'
                              : `Add ${selected.size} issues`}
                    </button>
                </div>
            </div>
        </section>
    );
}
