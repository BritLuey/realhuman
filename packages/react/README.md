# @realhuman/react

A React provider and hook for the [realHuman browser SDK](../client/README.md). Works with React 18+ and
Next.js (the entry point is marked `'use client'`).

realHuman scores each page load from 0 (bot) to 1 (human) for analytics filtering. It never blocks anyone.

## Install

```bash
npm install @realhuman/react @realhuman/client
```

## Use

Wrap your app once, near the root:

```tsx
import { RealHumanProvider } from '@realhuman/react';

export default function App({ children }) {
  return <RealHumanProvider options={{ endpoint: '/api/realhuman' }}>{children}</RealHumanProvider>;
}
```

Read the SDK instance and the latest result anywhere below it:

```tsx
import { useRealHuman } from '@realhuman/react';

function SignupButton() {
  const { instance, result } = useRealHuman();
  // result is null until the server sends one (deliver: 'client' or 'both').
  return <button onClick={() => instance?.score()}>Sign up</button>;
}
```

- The SDK starts once when the provider mounts (also under `StrictMode`) and stops when it unmounts.
- `options` are read once, on mount. They are the same options as `init()` in `@realhuman/client`.
- During server rendering, `instance` and `result` are `null`.

## Learn more

- [Browser SDK guide](../../docs/guides/browser-sdk.md)
- [All options](../../docs/reference/configuration.md#browser-sdk)
- [Delivery modes](../../docs/guides/delivery-modes.md)
