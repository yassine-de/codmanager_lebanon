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
