import { broadcast, EVENTS } from '../lib/events';
import { fetchIssues, requireIssueInProject, searchIssues } from '../lib/issues';
import { readFocus, readQueue, writeFocus, writeQueue } from '../lib/store';
import { handle } from './session';

// Resolvers for the project-level refinement page. Voting itself reuses the
// session resolvers - each issue still has its own independent session - so this
// file only covers what the page adds: the space's hand-picked estimation queue,
// the picker that fills it, and the shared "current issue".

const QUEUE_LIMIT = 100;

function projectOf(req) {
    const project = req.context?.extension?.project;

    if (!project?.id) {
        throw new Error('The refinement page must be opened from a Jira project.');
    }

    return { projectId: String(project.id), projectKey: project.key };
}

// The queue with live details, in queue order. Issues the viewer can't see, or
// that were deleted or moved to another space, simply don't appear.
async function queueDetails(projectId, issueIds) {
    const issues = await fetchIssues(projectId, issueIds);
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    return issueIds.map((id) => byId.get(id)).filter(Boolean);
}

// Every queue change is announced so all open pages refresh their copy - each
// with its own permissions, rather than receiving issue details in the event.
async function saveQueue(projectId, issueIds) {
    await writeQueue(projectId, issueIds);
    await broadcast(EVENTS.QUEUE, {});
    return { queue: await queueDetails(projectId, issueIds) };
}

export function defineRefinementResolvers(resolver) {
    resolver.define(
        'getRefinement',
        handle(async (req) => {
            const { projectId, projectKey } = projectOf(req);
            const [issueIds, focus] = await Promise.all([readQueue(projectId), readFocus(projectId)]);

            return {
                projectKey,
                queue: await queueDetails(projectId, issueIds),
                focusIssueId: focus?.issueId ?? null,
            };
        })
    );

    resolver.define(
        'searchIssues',
        handle(async (req) => {
            const { projectId } = projectOf(req);
            const text = String(req.payload?.text ?? '').slice(0, 500);
            const chip = String(req.payload?.chip ?? 'recent');
            // Opaque continuation token from Jira's search; it's passed back as an
            // encoded query parameter, so only its size needs bounding.
            const pageToken = req.payload?.pageToken ? String(req.payload.pageToken).slice(0, 2000) : null;

            return searchIssues(projectId, { text, chip, pageToken });
        })
    );

    resolver.define(
        'addToQueue',
        handle(async (req) => {
            const { projectId } = projectOf(req);
            const requested = (Array.isArray(req.payload?.issueIds) ? req.payload.issueIds : [])
                .map(String)
                .filter((id) => /^\d+$/.test(id))
                .slice(0, QUEUE_LIMIT);

            // Only issues the user can see in this space make it in.
            const allowed = (await fetchIssues(projectId, requested)).map((issue) => issue.id);
            const current = await readQueue(projectId);
            const additions = requested.filter((id) => allowed.includes(id) && !current.includes(id));
            const next = [...current, ...additions].slice(0, QUEUE_LIMIT);

            return saveQueue(projectId, next);
        })
    );

    resolver.define(
        'removeFromQueue',
        handle(async (req) => {
            const { projectId } = projectOf(req);
            const issueId = String(req.payload?.issueId ?? '');
            const current = await readQueue(projectId);

            return saveQueue(
                projectId,
                current.filter((id) => id !== issueId)
            );
        })
    );

    resolver.define(
        'clearQueue',
        handle(async (req) => {
            const { projectId } = projectOf(req);
            return saveQueue(projectId, []);
        })
    );

    resolver.define(
        'setFocus',
        handle(async (req) => {
            const { projectId } = projectOf(req);
            const { issueId } = await requireIssueInProject(req.payload?.issueId, projectId);

            await writeFocus(projectId, issueId);
            await broadcast(EVENTS.FOCUS, { issueId });

            return { focusIssueId: issueId };
        })
    );
}
