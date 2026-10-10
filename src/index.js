import Resolver from '@forge/resolver';

import { defineRefinementResolvers } from './resolvers/refinement';
import { defineSessionResolvers } from './resolvers/session';
import { defineSettingsResolvers } from './resolvers/settings';

const resolver = new Resolver();

defineSessionResolvers(resolver);
defineRefinementResolvers(resolver);
defineSettingsResolvers(resolver);

export const handler = resolver.getDefinitions();
