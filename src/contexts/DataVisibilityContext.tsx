import React, { createContext, useContext, useState } from "react";

interface DataVisibilityContextType {
  isDataVisible: boolean;
  toggleDataVisibility: () => void;
}

const DataVisibilityContext = createContext<DataVisibilityContextType>({
  isDataVisible: false,
  toggleDataVisibility: () => {},
});

export function DataVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [isDataVisible, setIsDataVisible] = useState(false);

  const toggleDataVisibility = () => setIsDataVisible((prev) => !prev);

  return (
    <DataVisibilityContext.Provider value={{ isDataVisible, toggleDataVisibility }}>
      {children}
    </DataVisibilityContext.Provider>
  );
}

export const useDataVisibility = () => useContext(DataVisibilityContext);

/** Masked placeholder shown when data is hidden */
export function MaskedValue({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-0.5 select-none ${className}`} aria-hidden="true">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
    </span>
  );
}
