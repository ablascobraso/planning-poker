import React, { useEffect, useState } from 'react';
import { view } from '@forge/bridge';

import RefinementPage from './components/RefinementPage';
import SessionView from './components/SessionView';
import { useAutoReveal } from './lib/useAutoReveal';
import { usePresence } from './lib/usePresence';
import { useSession } from './lib/useSession';

function IssuePanel() {
    const state = useSession();

    // The panel shows on every issue it was added to, for everyone who opens
    // that issue, so presence only runs while a round is open - the only time
    // "who's here" and auto-reveal matter. That keeps realtime traffic in line
    // with actual estimating rather than with general Jira browsing.
    const roundOpen = Boolean(state.session) && !state.session.revealed;
    const presence = usePresence(roundOpen);
    const autoReveal = useAutoReveal(state, presence);

    return <SessionView {...state} presence={presence} autoReveal={autoReveal} />;
}

// One bundle serves both modules in the manifest; the module type in the Forge
// context decides which experience to render.
export default function App() {
    const [moduleType, setModuleType] = useState(null);

    useEffect(() => {
        view.getContext().then((context) => setModuleType(context.extension?.type ?? 'unknown'));
    }, []);

    if (!moduleType) {
        return <div className="shell shell--centered muted">Loading…</div>;
    }

    return moduleType === 'jira:projectPage' ? <RefinementPage /> : <IssuePanel />;
}
