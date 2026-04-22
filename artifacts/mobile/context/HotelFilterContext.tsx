import React, { createContext, useContext, useState, ReactNode } from "react";

export type HotelFilter = number | "all";

interface HotelFilterContextValue {
  selectedHotelId: HotelFilter;
  setSelectedHotelId: (id: HotelFilter) => void;
}

const HotelFilterContext = createContext<HotelFilterContextValue>({
  selectedHotelId: "all",
  setSelectedHotelId: () => {},
});

export function HotelFilterProvider({ children }: { children: ReactNode }) {
  const [selectedHotelId, setSelectedHotelId] = useState<HotelFilter>("all");
  return (
    <HotelFilterContext.Provider value={{ selectedHotelId, setSelectedHotelId }}>
      {children}
    </HotelFilterContext.Provider>
  );
}

export function useHotelFilter() {
  return useContext(HotelFilterContext);
}

export function buildHotelParam(
  effectiveId: number | null,
  prefix: "?" | "&" = "?",
): string {
  return effectiveId ? `${prefix}hotelId=${effectiveId}` : "";
}
