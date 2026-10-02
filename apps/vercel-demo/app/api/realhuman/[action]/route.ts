import { createHandlers } from '@realhuman/vercel';
import { saveDecision } from '../../../../lib/store';

// The quickstart setup, with browser delivery switched on so the page can show its own score.
export const { GET, POST } = createHandlers({
  deliver: 'both',
  clientFields: ['realHuman', 'verdict', 'kind', 'confidence'],
  onDecision: async (record) => {
    console.log(JSON.stringify({ type: 'realhuman', ...record }));
    await saveDecision(record);
  },
});
