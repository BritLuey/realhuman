'use client';

import { RealHumanProvider } from '@realhuman/react';
import type { ReactNode } from 'react';
import { markersAsContext, readMarkers } from './labels';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RealHumanProvider
      options={{
        honeypot: { forms: 'form[data-realhuman]', trapLink: true, agentCanary: true },
        // Evaluated at each send, so test markers in the URL are always included.
        context: () => markersAsContext(readMarkers(window.location.search)),
      }}
    >
      {children}
    </RealHumanProvider>
  );
}
