import { beforeEach, describe, expect, it } from 'vitest';
import { jira, respond } from '@forge/api';
import { kvs } from '@forge/kvs';

import { defineSettingsResolvers } from '../src/resolvers/settings';
import { fromSpacePage, PROJECT_ID, resetForge, resolversFrom } from './helpers';

const resolvers = resolversFrom(defineSettingsResolvers);
const as = (accountId, name, payload) =>
    resolvers[name](fromSpacePage(accountId, payload, 'jira:projectSettingsPage'));

const STORY_POINTS = { id: 'customfield_10016', name: 'Story point estimate' };
const DEV = { id: 'customfield_10050', name: 'Development estimate' };
const QA = { id: 'customfield_10051', name: 'QA estimate' };

const numberField = (name, custom = 'com.atlassian.jira.plugin.system.customfieldtypes:float') => ({
    name,
    schema: { type: 'number', custom },
});

// A space with two issue types: stories (story points, dev estimate) and bugs
// (QA estimate). Only the space's admins may change its settings.
let isAdmin;
beforeEach(() => {
    resetForge();
    isAdmin = true;

    jira.on('GET', '/rest/api/3/mypermissions', () =>
        respond(200, { permissions: { ADMINISTER_PROJECTS: { havePermission: isAdmin } } })
    );
    jira.on('GET', '/rest/api/3/search/jql', () =>
        respond(200, {
            issues: [
                { id: '30001', fields: { issuetype: { id: 'story' } } },
                { id: '30002', fields: { issuetype: { id: 'bug' } } },
                { id: '30003', fields: { issuetype: { id: 'story' } } },
            ],
        })
    );
    jira.on('GET', '/rest/api/3/issue/30001/editmeta', () =>
        respond(200, {
            fields: {
                summary: { name: 'Summary', schema: { type: 'string', system: 'summary' } },
                [STORY_POINTS.id]: numberField(STORY_POINTS.name, 'com.pyxis.greenhopper.jira:jsw-story-points'),
                [DEV.id]: numberField(DEV.name),
            },
        })
    );
    jira.on('GET', '/rest/api/3/issue/30002/editmeta', () =>
        respond(200, { fields: { [QA.id]: numberField(QA.name) } })
    );
});

describe('where estimates are saved (space settings)', () => {
    it("lists the number fields used on the space's issues, story points first", async () => {
        const settings = await as('admin', 'getEstimationSettings');

        expect(settings.fields.map((field) => field.name)).toEqual([
            STORY_POINTS.name,
            DEV.name,
            QA.name,
        ]);
        expect(settings.automatic).toBe(true);
        expect(settings.detected.id).toBe(STORY_POINTS.id);
        // One issue per issue type is enough to find the fields.
        expect(jira.requestsTo('GET', /\/editmeta$/)).toHaveLength(2);
    });

    it("is only for the space's admins", async () => {
        isAdmin = false;

        for (const [name, payload] of [['getEstimationSettings'], ['saveEstimationSettings', { fieldIds: [DEV.id] }]]) {
            const result = await as('member', name, payload);
            expect(result.ok, name).toBe(false);
            expect(result.error, name).toMatch(/Only admins of this space/);
        }
        expect(await kvs.get(`pp:e:${PROJECT_ID}`)).toBeUndefined();
    });

    it("saves the chosen fields in order, with Jira's names, ignoring fields not used in the space", async () => {
        const saved = await as('admin', 'saveEstimationSettings', {
            fieldIds: [QA.id, 'customfield_99999', DEV.id, QA.id],
        });

        expect(saved.ok).toBe(true);
        expect((await kvs.get(`pp:e:${PROJECT_ID}`)).fields).toEqual([QA, DEV]);
        expect(saved.selected.map((field) => field.id)).toEqual([QA.id, DEV.id]);
        expect(saved.automatic).toBe(false);
    });

    it('goes back to automatic when the list is emptied', async () => {
        await as('admin', 'saveEstimationSettings', { fieldIds: [DEV.id] });
        const saved = await as('admin', 'saveEstimationSettings', { fieldIds: [] });

        expect(saved.automatic).toBe(true);
        expect(await kvs.get(`pp:e:${PROJECT_ID}`)).toBeUndefined();
    });

    it('flags a chosen field that is no longer used in the space', async () => {
        await kvs.set(`pp:e:${PROJECT_ID}`, {
            fields: [{ id: 'customfield_10052', name: 'Story Points' }, DEV],
            auto: false,
        });

        const settings = await as('admin', 'getEstimationSettings');

        expect(settings.selected).toEqual([
            { id: 'customfield_10052', name: 'Story Points', unused: true },
            { ...DEV, unused: false },
        ]);
    });
});
