import api, { route } from '@forge/api';

// Company-managed projects call the field "Story Points"; team-managed projects
// call it "Story point estimate". The custom field id differs per site, so it has
// to be discovered at runtime rather than hardcoded.
const KNOWN_NAMES = ['story points', 'story point estimate'];
const JSW_STORY_POINTS = 'com.pyxis.greenhopper.jira:jsw-story-points';

// editmeta (rather than /field) returns only the fields this user can actually
// edit on this issue, so discovery and the permission check happen in one call.
async function findStoryPointsField(issueId) {
    const response = await api
        .asUser()
        .requestJira(route`/rest/api/3/issue/${issueId}/editmeta`);

    if (!response.ok) {
        throw new Error(`Could not read issue fields (${response.status})`);
    }

    const { fields = {} } = await response.json();
    const candidates = Object.entries(fields).map(([id, field]) => ({
        id,
        name: (field.name ?? '').trim().toLowerCase(),
        custom: field.schema?.custom ?? '',
        type: field.schema?.type ?? '',
    }));

    return (
        candidates.find((f) => KNOWN_NAMES.includes(f.name))?.id ??
        candidates.find((f) => f.custom === JSW_STORY_POINTS)?.id ??
        candidates.find((f) => f.type === 'number' && f.name.includes('story point'))?.id ??
        null
    );
}

export async function saveStoryPoints(issueId, value) {
    const fieldId = await findStoryPointsField(issueId);

    if (!fieldId) {
        throw new Error(
            'No story points field is available on this issue. Check that the field is on the issue screen and that you have permission to edit it.'
        );
    }

    const response = await api
        .asUser()
        .requestJira(route`/rest/api/3/issue/${issueId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: { [fieldId]: value } }),
        });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Jira rejected the estimate (${response.status}): ${detail}`);
    }

    return fieldId;
}
