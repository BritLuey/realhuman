'use client';

import { RealHumanProvider } from '@realhuman/react';
import type { ReactNode } from 'react';
import { labelsAsContext, readLabels } from './labels';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RealHumanProvider
      options={{
        honeypot: { forms: 'form[data-realhuman]', trapLink: true, agentCanary: true },
        // Evaluated at each send, so labels in the URL are always included.
        context: () => labelsAsContext(readLabels(window.location.search)),
      }}
    >
      {children}
    </RealHumanProvider>
  );
}
