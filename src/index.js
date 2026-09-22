import Resolver from '@forge/resolver';

import { defineSessionResolvers } from './resolvers/session';

const resolver = new Resolver();

defineSessionResolvers(resolver);

export const handler = resolver.getDefinitions();
