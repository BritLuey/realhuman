'use client';

import {
  type ClientResult,
  init,
  type RealHumanInstance,
  type RealHumanOptions,
} from '@realhuman/client';
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export type { ClientResult, RealHumanInstance, RealHumanOptions } from '@realhuman/client';

export interface RealHumanState {
  /** The SDK instance, or null before the provider has mounted (and during server rendering). */
  readonly instance: RealHumanInstance | null;
  /** The latest result from the server, or null until one arrives (`client`/`both` delivery). */
  readonly result: ClientResult | null;
}

export interface RealHumanProviderProps {
  /** Passed to `init()` once, on mount. Later changes are ignored. */
  readonly options?: RealHumanOptions;
  readonly children?: ReactNode;
}

interface Live {
  readonly instance: RealHumanInstance;
  stop: ReturnType<typeof setTimeout> | undefined;
}

const EMPTY: RealHumanState = { instance: null, result: null };
const RealHumanContext = createContext<RealHumanState>(EMPTY);

/**
 * Starts realHuman once when it mounts and stops it when it unmounts. Put it near the root of
 * your app, then read the instance and latest result anywhere with `useRealHuman()`.
 */
export function RealHumanProvider({ options, children }: RealHumanProviderProps) {
  const [state, setState] = useState<RealHumanState>(EMPTY);
  const optionsRef = useRef(options);
  // Survives React StrictMode's mount → unmount → mount check, so the SDK starts only once.
  const live = useRef<Live>(null);

  useEffect(() => {
    const current: Live = live.current ?? { instance: init(optionsRef.current), stop: undefined };
    live.current = current;
    clearTimeout(current.stop);
    current.stop = undefined;
    const { instance } = current;
    const onResult = (result: ClientResult) => setState({ instance, result });
    instance.on('result', onResult);
    setState((previous) =>
      previous.instance === instance ? previous : { instance, result: null },
    );
    return () => {
      instance.off('result', onResult);
      // Destroy on the next task, unless StrictMode remounts straight away.
      current.stop = setTimeout(() => {
        instance.destroy();
        if (live.current === current) live.current = null;
      }, 0);
    };
  }, []);

  return createElement(RealHumanContext.Provider, { value: state }, children);
}

/** The SDK instance and the latest result. Re-renders when a new result arrives. */
export function useRealHuman(): RealHumanState {
  return useContext(RealHumanContext);
}
