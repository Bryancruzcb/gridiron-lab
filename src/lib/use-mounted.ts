import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/** False on the server and during hydration, true once the page runs in the browser. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
