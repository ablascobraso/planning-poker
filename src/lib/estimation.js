import api, { route } from '@forge/api';

import { readEstimationFields, writeEstimationFields } from './store';

// SAVING ESTIMATES TO JIRA. Each Jira space has an ordered list of the number
// fields its team estimates - most teams just "Story points", others e.g. "Dev
// estimate", "QA estimate" and "Story points" - and a session saves its agreed
// value to one of them at a time. A space admin picks the list on the app's
// space settings page; until then the space's story points field is found
// automatically, so most teams never need to configure anything.
//
// Every Jira call here runs asUser(), so Jira applies the person's own
// permissions: only people who may edit an issue can save to it.

// The most a space can estimate per issue - more would make a slog of a meeting.
export const MAX_ESTIMATION_FIELDS = 5;

// Company-managed spaces usually call it "Story Points", team-managed ones
// "Story point estimate"; the custom field id differs per site.
const STORY_POINT_NAMES = ['story points', 'story point estimate'];
const JSW_STORY_POINTS = 'com.pyxis.greenhopper.jira:jsw-story-points';

const isNumber = (field) => field.schema?.type === 'number';

// Picks the story points field from a list, preferring the usual names, then
// Jira Software's own story points type, then anything number-typed that
// mentions story points.
function storyPointsAmong(fields) {
    const name = (field) => (field.name ?? '').trim().toLowerCase();
    return (
        fields.find((field) => isNumber(field) && STORY_POINT_NAMES.includes(name(field))) ??
        fields.find((field) => field.schema?.custom === JSW_STORY_POINTS) ??
        fields.find((field) => isNumber(field) && name(field).includes('story point')) ??
        null
    );
}

// The fields this person can edit on one issue, as [{ id, name, schema }].
// editmeta only lists fields that apply to the issue (its space, its issue type,
// its screens), which is exactly what decides whether saving to them works.
async function editableFields(issueId) {
    const response = await api
        .asUser()
        .requestJira(route`/rest/api/3/issue/${issueId}/editmeta`);

    if (!response.ok) {
        return [];
    }

    const { fields = {} } = await response.json();
    return Object.entries(fields).map(([id, field]) => ({ id, ...field }));
}

// How many of a space's most recently updated issues are looked at to find its
// issue types, and how many issue types are then inspected.
const SAMPLE_ISSUES = 100;
const MAX_ISSUE_TYPES = 10;

// The custom number fields used in a space, for the settings page: story
// points first, then by name. Jira has no stable "fields of this space" API,
// so this looks at one recently updated issue of each issue type and gathers
// the number fields that can be edited on them - the same check saving relies
// on, so every field listed is one Jira will accept. (A space without issues
// yet has nothing to show.)
export async function spaceNumberFields(projectId) {
    const jql = `project = ${projectId} ORDER BY updated DESC`;
    const response = await api
        .asUser()
        .requestJira(route`/rest/api/3/search/jql?jql=${jql}&fields=issuetype&maxResults=${SAMPLE_ISSUES}`);

    if (!response.ok) {
        throw new Error(`Could not look up this space's issues (${response.status}).`);
    }

    const { issues = [] } = await response.json();
    const sampleByType = new Map();
    for (const issue of issues) {
        const type = issue.fields?.issuetype?.id;
        if (type && !sampleByType.has(type)) {
            sampleByType.set(type, issue.id);
        }
    }

    const perIssue = await Promise.all(
        [...sampleByType.values()].slice(0, MAX_ISSUE_TYPES).map(editableFields)
    );

    const byId = new Map();
    for (const field of perIssue.flat()) {
        if (field.schema?.custom && isNumber(field) && !byId.has(field.id)) {
            byId.set(field.id, field);
        }
    }

    const fields = [...byId.values()];
    const storyPoints = storyPointsAmong(fields);

    return fields
        .map((field) => ({
            id: field.id,
            name: field.name,
            storyPoints: field.id === storyPoints?.id,
        }))
        .sort((a, b) => Number(b.storyPoints) - Number(a.storyPoints) || a.name.localeCompare(b.name));
}

// The fields a space estimates, in order. If no admin has chosen them, this
// looks for the story points field among the fields of one of the space's
// issues and remembers the result for the space (see store.js). Returns [] if
// there's nothing to save to - sessions then simply don't offer saving.
export async function estimationTargets(projectId, issueId) {
    if (!projectId) {
        return [];
    }

    const saved = await readEstimationFields(projectId);
    if (saved) {
        return saved.fields;
    }

    if (!issueId) {
        return [];
    }

    // Fields that can be edited on this issue, so the one found is a field the
    // space actually uses.
    const storyPoints = storyPointsAmong(await editableFields(issueId));
    const detected = storyPoints ? [{ id: storyPoints.id, name: storyPoints.name }] : [];

    await writeEstimationFields(projectId, { fields: detected, auto: true });
    return detected;
}

// Whether the person may administer this space - required to change which
// fields it estimates. Jira's own permission check, so it follows the space's
// permission scheme (and site admins).
export async function isProjectAdmin(projectId) {
    const response = await api
        .asUser()
        .requestJira(
            route`/rest/api/3/mypermissions?projectId=${projectId}&permissions=ADMINISTER_PROJECTS`
        );

    if (!response.ok) {
        return false;
    }

    const { permissions } = await response.json();
    return permissions?.ADMINISTER_PROJECTS?.havePermission === true;
}

// Writes a number to one field of an issue, as the person saving. Jira refuses
// if they can't edit the issue or the field doesn't apply to it; its reason is
// passed on in plain words.
export async function saveFieldValue(issueId, field, value) {
    const response = await api.asUser().requestJira(route`/rest/api/3/issue/${issueId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { [field.id]: value } }),
    });

    if (response.ok) {
        return;
    }

    if (response.status === 403 || response.status === 401) {
        throw new Error("You don't have permission to edit this issue, so the estimate wasn't saved.");
    }

    // A 400 names the field that was refused and why (for example, a field
    // that isn't used by this issue type).
    let reason = '';
    try {
        const body = await response.json();
        reason = body?.errors?.[field.id] ?? body?.errorMessages?.[0] ?? '';
    } catch {
        // No readable reason; the generic message below has to do.
    }

    throw new Error(
        `Jira didn't accept the estimate for ${field.name}${reason ? `: ${reason}` : ` (${response.status})`}.`
    );
}
