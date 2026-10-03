import Resolver from '@forge/resolver';

import { defineRefinementResolvers } from './resolvers/refinement';
import { defineSessionResolvers } from './resolvers/session';

const resolver = new Resolver();

defineSessionResolvers(resolver);
defineRefinementResolvers(resolver);

export const handler = resolver.getDefinitions();
