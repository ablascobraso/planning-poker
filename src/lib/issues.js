import api, { route } from '@forge/api';

// Every call runs asUser(), so Jira applies the viewer's own permissions (project
// access, issue security levels). That is what keeps the refinement page from
// becoming a way to see or act on issues the user can't open in Jira itself.

const SEARCH_LIMIT = 30;

const toIssue = ({ id, key, fields }) => ({
    id: String(id),
    key,
    summary: fields?.summary ?? '',
    status: fields?.status?.name ?? '',
    projectId: String(fields?.project?.id ?? ''),
    // 1 = epic level; regular work items are 0 and subtasks -1.
    level: fields?.issuetype?.hierarchyLevel ?? 0,
});

// Details for specific issues (by id or key), keeping only ones in this space.
// Bulk fetch skips ids/keys that don't exist or aren't visible instead of failing
// the whole request, so a stale queue entry or a mistyped key just drops out.
export async function fetchIssues(projectId, idsOrKeys) {
    if (idsOrKeys.length === 0) {
        return [];
    }

    const response = await api.asUser().requestJira(route`/rest/api/3/issue/bulkfetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            issueIdsOrKeys: idsOrKeys,
            fields: ['summary', 'status', 'project'],
        }),
    });

    if (!response.ok) {
        throw new Error(`Could not load issue details (${response.status}).`);
    }

    const { issues = [] } = await response.json();
    return issues.map(toIssue).filter((issue) => issue.projectId === String(projectId));
}

// Story points live in a custom field whose name and id differ per site (and
// company- vs team-managed projects use different ones), so "unestimated" means
// empty in every story-points field the site has. Returns JQL, or null if none.
async function unestimatedClause() {
    const response = await api.asUser().requestJira(route`/rest/api/3/field`);

    if (!response.ok) {
        return null;
    }

    const fields = await response.json();
    const storyPoints = fields.filter(
        (field) =>
            field.custom &&
            field.schema?.type === 'number' &&
            /story ?points?/i.test(field.name ?? '') &&
            Number.isInteger(field.schema?.customId)
    );

    if (storyPoints.length === 0) {
        return null;
    }

    return `(${storyPoints.map((field) => `cf[${field.schema.customId}] is EMPTY`).join(' AND ')})`;
}

// Quick-pick chips in the "Add issues" picker. Each narrows a search that is
// always limited to unfinished, non-subtask work in this space.
const CHIPS = {
    recent: { jql: () => 'issue in issueHistory()', order: 'lastViewed DESC' },
    // Exactly the "Backlog" section of Jira's Backlog page: not in an active or a
    // planned sprint, including leftovers still tagged with a closed sprint. (Planned
    // sprints are the "Next sprint" chip.) NOT IN never matches an empty field,
    // hence the explicit "is EMPTY" branch. Epics are dropped after the search
    // (see below) rather than by name, which varies by site.
    backlog: {
        jql: () => '(sprint is EMPTY OR sprint not in (openSprints(), futureSprints()))',
        order: 'Rank ASC',
        hideEpics: true,
    },
    currentSprint: { jql: () => 'sprint in openSprints()', order: 'Rank ASC' },
    nextSprint: { jql: () => 'sprint in futureSprints()', order: 'Rank ASC' },
    unestimated: { jql: unestimatedClause, order: 'Rank ASC', hideEpics: true },
    created: { jql: () => 'created >= -14d', order: 'created DESC' },
};

const KEY_PATTERN = /\b[A-Z][A-Z0-9_]+-\d+\b/gi;

// Search text goes inside a JQL string, so anything that could close the string
// or act as Lucene syntax is stripped - leaving plain words that are safe to quote.
const searchTerms = (text) =>
    text
        .replace(/[+\-&|!(){}[\]^~*?:\\/"']/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 6);

const NO_RESULTS = { results: [], nextPageToken: null };

// Returns one page of results plus a token for the next page ("Show more").
export async function searchIssues(projectId, { text = '', chip = 'recent', pageToken = null } = {}) {
    // Pasted or typed issue keys ("PPT-12, PPT-15") are looked up directly, so a
    // whole batch can be found in one go.
    const keys = [...new Set((text.match(KEY_PATTERN) ?? []).map((key) => key.toUpperCase()))];
    if (keys.length > 0) {
        return { results: await fetchIssues(projectId, keys.slice(0, 50)), nextPageToken: null };
    }

    const preset = CHIPS[chip] ?? CHIPS.recent;
    const chipClause = await preset.jql();

    // E.g. "Unestimated" on a site with no story points field at all.
    if (!chipClause) {
        return NO_RESULTS;
    }

    const clauses = [
        `project = ${projectId}`,
        'statusCategory != Done',
        'issuetype not in subTaskIssueTypes()',
        chipClause,
        ...searchTerms(text).map((term) => `text ~ "${term}*"`),
    ];
    const jql = `${clauses.join(' AND ')} ORDER BY ${preset.order}`;
    const fields = 'summary,status,project,issuetype';

    const response = await api
        .asUser()
        .requestJira(
            pageToken
                ? route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=${SEARCH_LIMIT}&nextPageToken=${pageToken}`
                : route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=${SEARCH_LIMIT}`
        );

    // An odd search term can make Jira reject the query; that's "no results" to
    // the user, not an error worth interrupting them for.
    if (!response.ok) {
        return NO_RESULTS;
    }

    const { issues = [], nextPageToken = null } = await response.json();
    const results = issues.map(toIssue).filter((issue) => !preset.hideEpics || issue.level < 1);

    return { results, nextPageToken };
}

// On the refinement page the issue id arrives from the browser, so it can't be
// trusted the way the issue panel's own context can.
export async function requireIssueInProject(issueId, projectId) {
    const response = await api
        .asUser()
        .requestJira(route`/rest/api/3/issue/${issueId}?fields=project`);

    if (!response.ok) {
        throw new Error("You don't have access to that issue.");
    }

    const issue = await response.json();

    if (String(issue.fields?.project?.id) !== String(projectId)) {
        throw new Error('That issue is not part of this project.');
    }

    return { issueId: String(issue.id), issueKey: issue.key };
}
