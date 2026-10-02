import React from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';

import '@atlaskit/css-reset';
import './styles.css';

import App from './App';

// Makes Jira inject its design tokens and light/dark mode into this iframe.
view.theme.enable().catch((err) => console.warn('theming unavailable', err));

createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
