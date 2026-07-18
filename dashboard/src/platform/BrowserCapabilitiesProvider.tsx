import { createContext, type ReactNode, useContext } from 'react';

import { browserCapabilities, type BrowserCapabilities } from './browserCapabilities';

const BrowserCapabilitiesContext = createContext<BrowserCapabilities>(browserCapabilities);

export function BrowserCapabilitiesProvider({
  adapter = browserCapabilities,
  children,
}: {
  adapter?: BrowserCapabilities;
  children: ReactNode;
}) {
  return <BrowserCapabilitiesContext.Provider value={adapter}>{children}</BrowserCapabilitiesContext.Provider>;
}

export function useBrowserCapabilities() {
  return useContext(BrowserCapabilitiesContext);
}
