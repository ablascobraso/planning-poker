import { isProjectAdmin, MAX_ESTIMATION_FIELDS, spaceNumberFields } from '../lib/estimation';
import { deleteEstimationFields, readEstimationFields, writeEstimationFields } from '../lib/store';
import { handle } from './session';

// Resolvers for the app's page in a Jira space's settings, where a space admin
// picks which number fields the space's estimates are saved to, and in which
// order they're estimated. Jira only shows space settings to admins, but the
// resolvers can be called directly, so each one checks again.

async function requireAdmin(req) {
    const projectId = req.context?.extension?.project?.id;

    if (!projectId) {
        throw new Error('Open these settings from a Jira space.');
    }

    if (!(await isProjectAdmin(String(projectId)))) {
        throw new Error('Only admins of this space can change where estimates are saved.');
    }

    return String(projectId);
}

// What the settings page shows: the number fields used in this space, the
// space's chosen fields in order (empty while it's automatic) - each marked if
// it isn't used in the space, e.g. chosen before it changed - and what the
// automatic choice currently is.
async function settingsFor(projectId) {
    const [fields, saved] = await Promise.all([
        spaceNumberFields(projectId),
        readEstimationFields(projectId),
    ]);
    const automatic = !saved || saved.auto;
    const usable = new Set(fields.map((field) => field.id));

    return {
        fields,
        selected: automatic
            ? []
            : saved.fields.map((field) => ({ ...field, unused: !usable.has(field.id) })),
        automatic,
        detected: automatic ? fields.find((field) => field.storyPoints) ?? null : null,
        maxFields: MAX_ESTIMATION_FIELDS,
    };
}

export function defineSettingsResolvers(resolver) {
    resolver.define(
        'getEstimationSettings',
        handle(async (req) => settingsFor(await requireAdmin(req)))
    );

    // fieldIds: the chosen fields in estimation order; an empty list goes back
    // to automatic (the space's story points field). Names are taken from Jira,
    // not from the browser, and only real number fields are accepted.
    resolver.define(
        'saveEstimationSettings',
        handle(async (req) => {
            const projectId = await requireAdmin(req);
            const requested = Array.isArray(req.payload?.fieldIds) ? req.payload.fieldIds : [];
            const fields = await spaceNumberFields(projectId);

            const chosen = [...new Set(requested.filter((id) => typeof id === 'string'))]
                .map((id) => fields.find((field) => field.id === id))
                .filter(Boolean)
                .slice(0, MAX_ESTIMATION_FIELDS)
                .map(({ id, name }) => ({ id, name }));

            if (chosen.length === 0) {
                await deleteEstimationFields(projectId);
            } else {
                await writeEstimationFields(projectId, { fields: chosen, auto: false });
            }

            return settingsFor(projectId);
        })
    );
}
