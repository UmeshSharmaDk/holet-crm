import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

const C = Colors.light;

interface Booking {
  id: number;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  numberOfRooms: number;
  numberOfPersons: number;
  checkIn: string;
  checkOut: string;
  roomRent: number;
  addOns: number;
  totalCost: number;
  receipt: number;
  balance: number;
  status: "confirmed" | "checked_in" | "checked_out" | "cancelled";
  notes: string | null;
  hotelId: number;
  agencyId: number | null;
  agency?: { id: number; name: string } | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUS_COLORS: Record<string, string> = {
  confirmed: C.accent,
  checked_in: C.success,
  checked_out: C.textSecondary,
  cancelled: C.danger,
};

export default function BookingsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [search, setSearch] = useState("");
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const hotelParam = user?.role !== "admin" && user?.hotelId ? `&hotelId=${user.hotelId}` : "";
  const queryKey = ["bookings", selectedMonth, selectedYear, user?.hotelId];

  const { data: bookings, isLoading, refetch, isFetching } = useQuery<Booking[]>({
    queryKey,
    queryFn: () => api.get<Booking[]>(`/bookings?month=${selectedMonth}&year=${selectedYear}${hotelParam}`),
  });

  const filtered = (bookings ?? []).filter((b) => {
    const matchSearch = !search || b.guestName.toLowerCase().includes(search.toLowerCase()) || b.agency?.name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || b.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Bookings</Text>
        <Pressable style={styles.addBtn} onPress={() => router.push("/booking/new")}>
          <Feather name="plus" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.monthSelector}>
        <Pressable onPress={() => setShowMonthPicker(true)} style={styles.monthPill}>
          <Feather name="calendar" size={14} color={C.accent} />
          <Text style={styles.monthText}>{MONTHS[selectedMonth - 1]} {selectedYear}</Text>
          <Feather name="chevron-down" size={14} color={C.accent} />
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Feather name="search" size={16} color={C.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search guests, agencies..."
            placeholderTextColor={C.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      </View>

      <View style={styles.filterRow}>
        {["all", "confirmed", "checked_in", "checked_out", "cancelled"].map((s) => (
          <Pressable
            key={s}
            style={[styles.filterChip, filterStatus === s && styles.filterChipActive]}
            onPress={() => setFilterStatus(s)}
          >
            <Text style={[styles.filterChipText, filterStatus === s && styles.filterChipTextActive]}>
              {s === "all" ? "All" : s.replace("_", "-")}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          refreshing={isFetching}
          onRefresh={refetch}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="calendar" size={40} color={C.border} />
              <Text style={styles.emptyTitle}>No bookings found</Text>
              <Text style={styles.emptyText}>Tap + to create your first booking</Text>
            </View>
          }
          renderItem={({ item }) => <BookingCard booking={item} />}
        />
      )}

      <Modal visible={showMonthPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Month</Text>
              <Pressable onPress={() => setShowMonthPicker(false)}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>
            <View style={styles.yearRow}>
              <Pressable onPress={() => setSelectedYear((y) => y - 1)}>
                <Feather name="chevron-left" size={24} color={C.text} />
              </Pressable>
              <Text style={styles.yearText}>{selectedYear}</Text>
              <Pressable onPress={() => setSelectedYear((y) => y + 1)}>
                <Feather name="chevron-right" size={24} color={C.text} />
              </Pressable>
            </View>
            <View style={styles.monthGrid}>
              {MONTHS.map((m, i) => (
                <Pressable
                  key={m}
                  style={[styles.monthCell, selectedMonth === i + 1 && styles.monthCellActive]}
                  onPress={() => { setSelectedMonth(i + 1); setShowMonthPicker(false); }}
                >
                  <Text style={[styles.monthCellText, selectedMonth === i + 1 && styles.monthCellTextActive]}>{m}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function BookingCard({ booking }: { booking: Booking }) {
  const nights = Math.ceil((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000);
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      onPress={() => router.push(`/booking/${booking.id}` as any)}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardLeft}>
          <Text style={styles.cardGuest}>{booking.guestName}</Text>
          {booking.agency && <Text style={styles.cardAgency}>{booking.agency.name}</Text>}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[booking.status] + "20" }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[booking.status] }]}>
            {booking.status.replace("_", " ")}
          </Text>
        </View>
      </View>
      <View style={styles.cardDetails}>
        <DetailChip icon="log-in" text={formatDate(booking.checkIn)} />
        <DetailChip icon="log-out" text={formatDate(booking.checkOut)} />
        <DetailChip icon="moon" text={`${nights}n`} />
        <DetailChip icon="grid" text={`${booking.numberOfRooms ?? 1} rm`} />
        <DetailChip icon="users" text={`${booking.numberOfPersons ?? 1} pax`} />
      </View>
      <View style={styles.cardFinancials}>
        <View>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>₹{booking.totalCost.toFixed(2)}</Text>
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

function DetailChip({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.chip}>
      <Feather name={icon as any} size={12} color={C.textSecondary} />
      <Text style={styles.chipText}>{text}</Text>
    </View>
  );
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  addBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accent, justifyContent: "center", alignItems: "center" },
  monthSelector: { paddingHorizontal: 20, marginBottom: 12 },
  monthPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.accentLight, alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  monthText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.accent },
  searchRow: { paddingHorizontal: 16, marginBottom: 8 },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text },
  filterRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 4 },
  filterChip: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surfaceSecondary },
  filterChipActive: { backgroundColor: C.primary },
  filterChipText: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textSecondary },
  filterChipTextActive: { color: "#fff" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  cardLeft: { flex: 1 },
  cardGuest: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text },
  cardAgency: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 11, textTransform: "capitalize" },
  cardDetails: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.surfaceSecondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  cardFinancials: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12 },
  totalLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary },
  totalValue: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  balancePill: { backgroundColor: C.dangerLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  balanceText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.danger },
  paidPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.successLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  paidText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.success },
  emptyState: { alignItems: "center", paddingTop: 60, gap: 8 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  yearRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 24, marginBottom: 20 },
  yearText: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthCell: { width: "22%", padding: 12, borderRadius: 12, alignItems: "center", backgroundColor: C.surfaceSecondary },
  monthCellActive: { backgroundColor: C.primary },
  monthCellText: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  monthCellTextActive: { color: "#fff" },
});
