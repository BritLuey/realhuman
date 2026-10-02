import { createLambdaHandler } from '../../src/index.js';

export const handler = createLambdaHandler({
  onDecision: (record) => {
    console.log(JSON.stringify({ type: 'realhuman', ...record }));
  },
});
