import { broadcast, EVENTS } from '../lib/events';
import { listOpenIssues, requireIssueInProject } from '../lib/issues';
import { readFocus, writeFocus } from '../lib/store';
import { handle } from './session';

// Resolvers for the project-level refinement page. Voting itself reuses the
// session resolvers - each issue still has its own independent session - so this
// file only covers what the page adds: the issue list and the shared "current
// issue" everyone on the page is estimating.

function projectOf(req) {
    const project = req.context?.extension?.project;

    if (!project?.id) {
        throw new Error('The refinement page must be opened from a Jira project.');
    }

    return { projectId: String(project.id), projectKey: project.key };
}

export function defineRefinementResolvers(resolver) {
    resolver.define(
        'getRefinement',
        handle(async (req) => {
            const { projectId, projectKey } = projectOf(req);
            const [issues, focus] = await Promise.all([
                listOpenIssues(projectId),
                readFocus(projectId),
            ]);

            return { projectKey, issues, focusIssueId: focus?.issueId ?? null };
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
