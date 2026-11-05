import base from './vitest.config.mts';

export default { ...base, test: { ...base.test, include: ['tests/live/**/*.live.test.ts'], exclude: ['node_modules/**'] } };
