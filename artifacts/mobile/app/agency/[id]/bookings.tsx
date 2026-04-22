import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { api } from "@/lib/api";

const C = Colors.light;

interface Booking {
  id: number;
  guestName: string;
  numberOfRooms: number;
  numberOfPersons: number;
  checkIn: string;
  checkOut: string;
  status: string;
  totalCost: number;
  receipt: number;
  balance: number;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: C.accent,
  checked_in: C.success,
  checked_out: C.textSecondary,
  cancelled: C.danger,
};

export default function AgencyBookingsScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const agencyName = name || "Agency";

  const { data: bookings, isLoading, refetch, isFetching } = useQuery<Booking[]>({
    queryKey: ["agency-bookings", id],
    queryFn: () => api.get<Booking[]>(`/bookings?agencyId=${id}`),
    enabled: !!id,
  });

  const { totalRevenue, totalBalance } = useMemo(() => {
    if (!bookings) return { totalRevenue: 0, totalBalance: 0 };
    return bookings.reduce(
      (acc, b) => ({
        totalRevenue: acc.totalRevenue + (b.totalCost ?? 0),
        totalBalance: acc.totalBalance + (b.balance ?? 0),
      }),
      { totalRevenue: 0, totalBalance: 0 }
    );
  }, [bookings]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle} numberOfLines={1}>{agencyName}</Text>
          <Text style={styles.topSubtitle}>{bookings?.length ?? 0} bookings</Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { backgroundColor: C.successLight }]}>
          <Feather name="trending-up" size={18} color={C.success} />
          <Text style={styles.summaryLabel}>Total Revenue</Text>
          <Text style={[styles.summaryValue, { color: C.success }]}>
            ₹{totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </Text>
        </View>
        <View style={[styles.summaryCard, { backgroundColor: totalBalance > 0 ? "#FEE2E2" : C.successLight }]}>
          <Feather name="alert-circle" size={18} color={totalBalance > 0 ? C.danger : C.success} />
          <Text style={styles.summaryLabel}>Balance Due</Text>
          <Text style={[styles.summaryValue, { color: totalBalance > 0 ? C.danger : C.success }]}>
            ₹{totalBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : !bookings || bookings.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="inbox" size={40} color={C.border} />
          <Text style={styles.emptyText}>No bookings for this agency</Text>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(b) => String(b.id)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
          renderItem={({ item }) => <BookingCard booking={item} />}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={C.accent} />}
        />
      )}
    </View>
  );
}

function BookingCard({ booking }: { booking: Booking }) {
  const statusColor = STATUS_COLORS[booking.status] ?? C.textSecondary;
  const statusLabel = booking.status.replace("_", " ");
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      onPress={() => router.push(`/booking/${booking.id}` as any)}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.guestName} numberOfLines={1}>{booking.guestName}</Text>
        <View style={[styles.statusPill, { backgroundColor: statusColor + "20" }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>
      <View style={styles.cardMeta}>
        <View style={styles.metaItem}>
          <Feather name="grid" size={12} color={C.textSecondary} />
          <Text style={styles.metaText}>{booking.numberOfRooms ?? 1} room{(booking.numberOfRooms ?? 1) !== 1 ? "s" : ""} · {booking.numberOfPersons ?? 1} pax</Text>
        </View>
        <View style={styles.metaItem}>
          <Feather name="calendar" size={12} color={C.textSecondary} />
          <Text style={styles.metaText}>{booking.checkIn} → {booking.checkOut}</Text>
        </View>
      </View>
      <View style={styles.cardFooter}>
        <View>
          <Text style={styles.footerLabel}>Total</Text>
          <Text style={styles.footerValue}>₹{booking.totalCost.toFixed(2)}</Text>
        </View>
        {booking.balance > 0 ? (
          <View style={styles.balancePill}>
            <Text style={styles.balanceText}>Balance: ₹{booking.balance.toFixed(2)}</Text>
          </View>
        ) : (
          <View style={styles.paidPill}>
            <Feather name="check-circle" size={13} color={C.success} />
            <Text style={styles.paidText}>Paid</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  topSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  summaryRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  summaryCard: { flex: 1, borderRadius: 14, padding: 14, gap: 4 },
  summaryLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 4 },
  summaryValue: { fontFamily: "Inter_700Bold", fontSize: 18, letterSpacing: -0.5 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  guestName: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text, flex: 1, marginRight: 8 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 10, textTransform: "capitalize" },
  cardMeta: { gap: 4, marginBottom: 10 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  footerLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary },
  footerValue: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  balancePill: { backgroundColor: "#FEE2E2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  balanceText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.danger },
  paidPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.successLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  paidText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.success },
});
