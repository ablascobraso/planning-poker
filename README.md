# Planning Poker for Jira

Private, real-time planning poker for Jira Cloud, built on [Atlassian Forge](https://developer.atlassian.com/platform/forge/) and running entirely on Atlassian's infrastructure (no external servers or databases).

## Features

- **Estimate from any issue.** An issue panel runs a session on that issue, with four decks: Fibonacci, Modified Fibonacci, T-shirts and Powers of 2.
- **Private voting.** Nobody sees a card until the reveal. This is enforced on the server, not just hidden in the UI.
- **Rounds.** Reveal, discuss, start a new round, or end the session. The results are highlighted, with a little confetti when everyone agrees. Earlier rounds are kept in a collapsible round history, and hovering a card shows who played it.
- **Saves the estimate to Jira.** After the reveal, one click saves the agreed value to the issue: story points, or whichever number fields the space estimates (for example Dev estimate, then QA estimate, then Story points, one field at a time). Jira's issue view updates straight away, without reloading the page.
- **Who's here.** See who has the session open, who has already voted (highlighted) and who the team is waiting for.
- **Just watching.** People who listen but don't estimate (a product owner, say) can switch to watching, so nobody waits for them.
- **Auto-reveal.** When everyone voting has voted, the cards turn after a short countdown that anyone can hold with **Wait**.
- **Facilitator controls (optional).** With **Lead this session**, only the person who started the session can reveal, start a new round, save the estimate, end it or switch issues. If they leave, anyone can **Take over**.
- **Refinement page.** A project tab where the team builds an estimation queue (search, paste several keys, or use the quick buttons for Unestimated, Recently viewed, Recently created, Backlog, Current sprint and Next sprint) and estimates the issues one after another, moving together.
- **Live everywhere.** The issue panel and the refinement page stay in sync in real time, and the queue shows the estimates already saved.
- **Remembers your choices.** The deck and the lead choice are remembered per Jira space, so starting is usually one click.
- **Looks native.** Uses Jira's design tokens, including dark mode.

## How it works

| Part | Where | What it does |
| --- | --- | --- |
| Frontend | `static/planning-poker` | Custom UI (React + Vite). One bundle serves every module and picks the view from the Forge context. |
| Backend | `src/` | Forge resolvers. Every action is checked here: issue access, vote privacy, facilitator rules and what may be saved to Jira. |
| Modules | `manifest.yml` | `jira:issuePanel` (per-issue sessions), `jira:projectPage` (refinement page) and `jira:projectSettingsPage` (where a space's estimates are saved). All share the same resolver. |
| Storage | Forge Key-Value Store | Sessions, votes and per-space settings (see below). |
| Live updates | Forge Realtime | Session events, presence and refinement-page events (see below). |

**Vote privacy.** While a round is open, the server never sends anyone's card to a browser; clients only learn *that* someone voted. Cards leave the server in the reveal, and only then.

**Saving estimates** (`src/lib/estimation.js`):

- Each Jira space has an ordered list of **estimation fields**: number fields such as Story points, or Dev estimate, QA estimate and Story points. Space admins choose them in the space's settings, under **Apps → Planning Poker**, from the number fields used on the space's issues. With nothing chosen, the space's story points field is detected automatically.
- A session estimates one field at a time. After the reveal, **Save 5 to Dev estimate** writes the value. The most-voted number is preselected, and the other numbers played are one-click alternatives. **Next: QA estimate** then starts a fresh round for the next field.
- Saving follows the reveal rules (only the facilitator in a led session), only accepts number cards actually played this round, and writes as the person saving, so Jira's own edit permissions apply.
- The issue panel then asks Jira to reload the issue (Forge's `view.refresh()`), for the person saving and, through a live update, for everyone else on the issue, so the field shows the new value without reloading the page.

**Live update channels** (`src/lib/events.js`, `static/planning-poker/src/lib/usePresence.js`):

- **Session events** (votes, reveal, rounds, end, take over, saved estimates) use one channel scoped to the Jira project, narrowed to a single issue by a signed token. Browsers receive a listen-only token from `getState` after the access check and renew it before it expires (tokens currently last one hour). This lets the issue panel and the refinement page hear each other, and stops browsers from publishing fake votes or reveals.
- **Presence** ("who's here", "just watching" and the auto-reveal hold) runs between browsers on a project-wide channel, with each message naming the issue the viewer is on. As a deliberate trade-off, anyone with the app open in the project receives these messages: a name, an avatar and an issue ID, never a card or an issue title.
- **Refinement page events** (queue, current issue) use Forge's default scoping, so only that project's refinement pages receive them.

**Permissions (scopes):**

- `storage:app`: the Key-Value Store.
- `read:jira-user`: the voter's display name and avatar.
- `read:jira-work`: finding and reading issues for the refinement page's queue, the number fields used in a space, and checking who administers a space.
- `write:jira-work`: saving an estimate to an issue.

The app only writes to Jira when someone saves an estimate, and then only to the space's chosen estimation field, as that person.

## Data the app stores

| Data | Key | Kept for |
| --- | --- | --- |
| Session: deck, round, revealed flag, facilitator (account ID and name), round history (account ID, name and card of each revealed round), the estimation fields being estimated and the last value saved (with who saved it) | `pp:s:{issueId}` | 72 hours after the last start, reveal or new round. Deleted by **End**. |
| Votes: account ID, name, avatar URL, card | `pp:v:{issueId}:{accountId}` | Same as the session. Cleared at each new round. |
| Refinement page's current issue | `pp:f:{projectId}` | 72 hours |
| Space defaults: deck and lead choice | `pp:d:{projectId}` | Until changed |
| Estimation queue: issue IDs only | `pp:q:{projectId}` | Until changed |
| Space's estimation fields: field IDs and names | `pp:e:{projectId}` | Until changed, if chosen by an admin. 7 days if detected automatically, then detected again. |

Forge deletes expired keys on its own, which can lag behind the expiry time, so the app also checks the age of a session when reading it. Presence messages are never stored. Estimate values live in Jira's issue fields, not in the app. The "Just watching" choice is kept in each person's browser only.

## Project layout

```
manifest.yml                 Forge modules, resources and scopes
src/
  index.js                   Resolver entry point
  resolvers/session.js       Session actions: state, start, vote, reveal, rounds, end, take over, save estimate
  resolvers/refinement.js    Refinement page: queue, issue search, current issue
  resolvers/settings.js      Space settings: which fields estimates are saved to
  lib/store.js               Key-Value Store access and expiry
  lib/events.js              Realtime channels and tokens
  lib/estimation.js          Estimation fields: detection, space admin check, saving to Jira
  lib/issues.js              Jira issue search and access checks
  lib/scales.js              Decks
test/
  *.test.js                  Tests for the backend rules (run with npm test)
  fakes/                     In-memory stand-ins for Forge's storage, realtime and Jira APIs
static/planning-poker/
  src/App.jsx                Chooses the issue panel, refinement page or settings page
  src/components/            UI components
  src/lib/                   Session, presence, auto-reveal and confetti hooks, API wrapper
```

## Development

You need Node.js (a current LTS) and the [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/), logged in with `forge login`.

Install dependencies for the backend and the frontend:

```bash
npm install
npm run install:ui
```

Build the frontend. Forge deploys the built bundle, so rebuild after every UI change:

```bash
npm run build
```

Check the manifest and code, then deploy:

```bash
forge lint
forge deploy -e development
```

A change to the scopes in `manifest.yml` makes a new major version: `forge deploy` asks you to approve it. Install on a site the first time, or upgrade the installation after a scope change so the site grants the new permissions:

```bash
forge install --site <your-site>.atlassian.net --product jira -e development
forge install --upgrade --site <your-site>.atlassian.net --product jira -e development
```

Run the tests. They cover the backend's core rules: no card leaves the server before the reveal, facilitator controls, auto-reveal's re-check, what may be saved to Jira, switching issues on the refinement page, the space settings admin check and session expiry. They run the real resolvers against in-memory fakes of Forge's storage, realtime and Jira APIs (`test/fakes`), so they need no Forge site:

```bash
npm test
```

Read the app's logs:

```bash
forge logs -e development --since 15m
```

### Testing with a second person

While the app is in development distribution, only its owner can use it. To test with another account, add it as a contributor (the **Viewer** role is enough) in the Developer Console under your app, **Contributors**. That account also needs access to the Jira site.
