import { tagRequests } from '@realhuman/vercel';

// Network-only labels for every page request, including clients that never run JavaScript.
// They appear in the function logs as `realhuman-edge`. This never blocks anything.
export default tagRequests({
  onTag: (tag) => console.log(JSON.stringify({ type: 'realhuman-edge', ...tag })),
});

export const config = {
  matcher: ['/((?!_next/|api/|favicon.ico).*)'],
};
