/**
 * React binding for {@link last-module-search} — keep sidebar hops sticky.
 */

import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  asSearchRecord,
  isConsoleModulePath,
  loadLastModuleSearch,
  rememberModuleSearch,
  saveLastModuleSearch,
  type LastModuleSearch,
} from "./last-module-search.ts";

/**
 * Remember the current module's search and return the full map.
 */
export function useLastModuleSearch(): LastModuleSearch {
  const location = useRouterState({
    select: (s) => ({ pathname: s.location.pathname, search: s.location.search }),
  });
  const [memory, setMemory] = useState<LastModuleSearch>(loadLastModuleSearch);

  useEffect(() => {
    if (!isConsoleModulePath(location.pathname)) return;
    const search = asSearchRecord(location.search);
    setMemory((prev) => {
      const next = rememberModuleSearch(prev, location.pathname, search);
      if (next === prev) return prev;
      saveLastModuleSearch(next);
      return next;
    });
  }, [location.pathname, location.search]);

  return memory;
}
