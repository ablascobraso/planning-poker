import React, { useEffect, useState } from 'react';

import * as api from '../lib/api';

// The app's page in a Jira space's settings (Space settings → Apps), for space
// admins: which number fields Planning Poker saves estimates to, and in which
// order the team estimates them. With nothing chosen it's automatic - the
// space's story points field - which is all most teams need. The fields offered
// are the number fields used on this space's issues (see estimation.js).
export default function SettingsPage() {
    const [settings, setSettings] = useState(null);
    // The chosen fields in order, as { id, name, unused }.
    const [chosen, setChosen] = useState([]);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [savedNote, setSavedNote] = useState(null);

    const apply = (data) => {
        setSettings(data);
        setChosen(data.selected);
    };

    useEffect(() => {
        api.getEstimationSettings()
            .then(apply)
            .catch((err) => setError(err.message));
    }, []);

    if (error && !settings) {
        return (
            <div className="settings">
                <div className="banner banner--error" role="alert">
                    <span>{error}</span>
                </div>
            </div>
        );
    }

    if (!settings) {
        return <div className="shell shell--centered muted">Loading…</div>;
    }

    const ids = (list) => list.map((field) => field.id).join();
    const changed = ids(chosen) !== ids(settings.selected);
    const available = settings.fields.filter((field) => !chosen.some((picked) => picked.id === field.id));
    const full = chosen.length >= settings.maxFields;

    const move = (index, step) => {
        const next = [...chosen];
        [next[index], next[index + step]] = [next[index + step], next[index]];
        setChosen(next);
    };

    // fields: the chosen fields in order; [] goes back to automatic.
    const save = async (fields) => {
        setSaving(true);
        try {
            apply(await api.saveEstimationSettings(fields.map((field) => field.id)));
            setError(null);
            setSavedNote('Saved. New sessions in this space use these fields.');
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="settings">
            {error && (
                <div className="banner banner--error" role="alert">
                    <span>{error}</span>
                    <button type="button" className="banner__close" onClick={() => setError(null)}>
                        ×
                    </button>
                </div>
            )}

            <h2 className="empty__title">Where estimates are saved</h2>
            <p className="muted settings__intro">
                After the cards are revealed, Planning Poker saves the agreed estimate to the issue.
                Choose the number fields your team estimates, in the order you estimate them, for
                example Dev estimate, then QA estimate, then Story points. Leave the list empty to
                use this space's story points field automatically.
            </p>

            {chosen.length === 0 ? (
                <p className="settings__auto">
                    Automatic:{' '}
                    {settings.detected
                        ? `estimates are saved to ${settings.detected.name}.`
                        : 'no story points field was found, so estimates aren’t saved until you choose a field.'}
                </p>
            ) : (
                <ol className="settings__fields">
                    {chosen.map((field, index) => (
                        <li
                            key={field.id}
                            className={`settings__field${field.unused ? ' settings__field--unused' : ''}`}
                        >
                            <span className="settings__order">{index + 1}</span>
                            <span className="settings__name">
                                {field.name}
                                {field.unused && (
                                    <span className="settings__warning">
                                        Not used on this space's issues, so estimates can't be saved to
                                        it. Remove it or choose another field.
                                    </span>
                                )}
                            </span>
                            <button
                                type="button"
                                className="link link--subtle"
                                aria-label={`Move ${field.name} up`}
                                disabled={index === 0}
                                onClick={() => move(index, -1)}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                className="link link--subtle"
                                aria-label={`Move ${field.name} down`}
                                disabled={index === chosen.length - 1}
                                onClick={() => move(index, 1)}
                            >
                                ↓
                            </button>
                            <button
                                type="button"
                                className="link link--subtle"
                                aria-label={`Remove ${field.name}`}
                                onClick={() => setChosen(chosen.filter((other) => other.id !== field.id))}
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ol>
            )}

            <label className="field settings__add">
                <span className="field__label">
                    {full ? `Up to ${settings.maxFields} fields` : 'Add a field'}
                </span>
                <select
                    className="field__control"
                    value=""
                    disabled={full || available.length === 0}
                    onChange={(event) => {
                        const field = available.find((option) => option.id === event.target.value);
                        if (field) {
                            setChosen([...chosen, field]);
                        }
                    }}
                >
                    <option value="">
                        {settings.fields.length === 0
                            ? 'No number fields on this space\u2019s issues yet'
                            : 'Choose a number field…'}
                    </option>
                    {available.map((field) => (
                        <option key={field.id} value={field.id}>
                            {field.name}
                        </option>
                    ))}
                </select>
            </label>

            <div className="settings__actions">
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={!changed || saving}
                    onClick={() => save(chosen)}
                >
                    Save
                </button>
                {!settings.automatic && (
                    <button type="button" className="btn" disabled={saving} onClick={() => save([])}>
                        Use automatic
                    </button>
                )}
                {savedNote && !changed && <span className="muted">{savedNote}</span>}
            </div>
        </div>
    );
}
