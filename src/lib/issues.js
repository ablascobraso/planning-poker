import api, { route } from '@forge/api';

// Both calls run asUser(), so Jira applies the viewer's own permissions (project
// access, issue security levels). That is what keeps the refinement page from
// becoming a way to read or act on issues the user can't open in Jira itself.

const LIST_LIMIT = 50;

// The backlog-plus-sprint view a team refines from: unfinished work items in rank
// order, without subtasks (they're estimated through their parent).
export async function listOpenIssues(projectId) {
    const jql = `project = ${projectId} AND statusCategory != Done AND issuetype not in subTaskIssueTypes() ORDER BY Rank ASC`;
    const response = await api
        .asUser()
        .requestJira(
            route`/rest/api/3/search/jql?jql=${jql}&fields=summary,status&maxResults=${LIST_LIMIT}`
        );

    if (!response.ok) {
        throw new Error(`Could not load this project's issues (${response.status}).`);
    }

    const { issues = [] } = await response.json();

    return issues.map(({ id, key, fields }) => ({
        id: String(id),
        key,
        summary: fields?.summary ?? '',
        status: fields?.status?.name ?? '',
    }));
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
