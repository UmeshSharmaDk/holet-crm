import { QueryClient } from "@tanstack/react-query";

// The same client is used by the provider and by successful record writes.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000 },
  },
});

const bookingKeys = [
  "booking", "bookings", "agency-bookings", "dashboard-stats",
  "dashboard-checkins", "dashboard-checkouts", "dashboard-forecast",
  "occupancy", "revenue",
];
const dependencies: Record<string, string[]> = {
  bookings: bookingKeys,
  agencies: ["agency", "agencies", ...bookingKeys],
  hotels: ["hotel", "hotels", "user", "users", "agency", "agencies", ...bookingKeys],
  users: ["user", "users"],
};

export function refreshAfterWrite(path: string) {
  const resource = path.split("/").filter(Boolean)[0];
  const keys = dependencies[resource];
  if (!keys) return Promise.resolve();
  // Inactive queries are marked stale too; mounted related pages refresh now.
  // Refresh failure must not turn a successfully saved record into a failed save.
  return queryClient.invalidateQueries({
    predicate: (query) => keys.includes(String(query.queryKey[0])),
    refetchType: "active",
  }).catch((error) => console.error("Related data refresh failed:", error));
}

export async function refreshPageData() {
  await queryClient.refetchQueries({ type: "active" }, { throwOnError: true });
}
