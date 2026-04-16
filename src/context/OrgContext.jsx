// src/context/OrgContext.jsx
import { createContext, useContext, useState, useCallback } from "react";

/**
 * Active bottle/entry context — persisted in localStorage.
 *
 * Shape of `active`:
 *   {
 *     bottleId:  string,  // Firestore doc ID  (e.g. "de-la-iglesia")
 *     orgId:     string,  // URL param         (e.g. "iglesia")
 *     bottleName: string,
 *     entryId:   string | null,
 *     entryName: string | null,
 *   }
 */

const OrgContext = createContext(null);

const STORAGE_KEY = "parochia_active_org";

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(data) {
  try {
    if (data) localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

export function OrgProvider({ children }) {
  const [active, setActiveState] = useState(load);

  const setActive = useCallback((data) => {
    setActiveState(data);
    save(data);
  }, []);

  const clear = useCallback(() => {
    setActiveState(null);
    save(null);
  }, []);

  return (
    <OrgContext.Provider value={{ active, setActive, clear }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  return useContext(OrgContext);
}
