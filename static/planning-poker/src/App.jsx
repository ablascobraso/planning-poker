import React, { useEffect, useState } from 'react';
import { view } from '@forge/bridge';

import RefinementPage from './components/RefinementPage';
import SessionView from './components/SessionView';
import { useSession } from './lib/useSession';

function IssuePanel() {
    return <SessionView {...useSession()} />;
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
