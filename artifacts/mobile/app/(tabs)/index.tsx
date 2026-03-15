import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

const C = Colors.light;

interface DashboardStats {
  todayCheckins: number;
  todayCheckouts: number;
  totalBookings: number;
  occupiedRooms: number;
  totalRooms: number;
  occupancyPercentage: number;
  monthlyRevenue: number;
}

interface Booking {
  id: number;
  guestName: string;
  roomNumber: string | null;
  roomType: string | null;
  checkIn: string;
  checkOut: string;
  status: string;
  totalCost: number;
  balance: number;
}

export default function DashboardScreen() {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();

  const hotelParam = user?.role !== "admin" && user?.hotelId ? `?hotelId=${user.hotelId}` : "";

  const statsQuery = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats", user?.hotelId],
    queryFn: () => api.get<DashboardStats>(`/dashboard/stats${hotelParam}`),
  });

  const checkinsQuery = useQuery<Booking[]>({
    queryKey: ["dashboard-checkins", user?.hotelId],
    queryFn: () => api.get<Booking[]>(`/dashboard/checkins${hotelParam}`),
  });

  const checkoutsQuery = useQuery<Booking[]>({
    queryKey: ["dashboard-checkouts", user?.hotelId],
    queryFn: () => api.get<Booking[]>(`/dashboard/checkouts${hotelParam}`),
  });

  const isLoading = statsQuery.isLoading;

  function refetchAll() {
    statsQuery.refetch();
    checkinsQuery.refetch();
    checkoutsQuery.refetch();
  }

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + (Platform_isWeb() ? 67 : 20), paddingBottom: insets.bottom + 100 },
      ]}
      refreshControl={<RefreshControl refreshing={statsQuery.isFetching} onRefresh={refetchAll} tintColor={C.accent} />}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good day,</Text>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.date}>{today}</Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{user?.role?.toUpperCase()}</Text>
          </View>
          <Pressable onPress={logout} style={styles.logoutBtn}>
            <Feather name="log-out" size={20} color={C.textSecondary} />
          </Pressable>
        </View>
      </View>

      {user?.hotel && (
        <View style={styles.hotelBanner}>
          <Feather name="home" size={16} color={C.gold} />
          <Text style={styles.hotelName}>{user.hotel.name}</Text>
          <Text style={styles.hotelRooms}>{user.hotel.totalRooms} Rooms</Text>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : (
        <>
          <View style={styles.statsRow}>
            <StatCard
              icon="log-in"
              iconColor={C.checkin}
              iconBg={C.successLight}
              label="Today's Check-ins"
              value={String(statsQuery.data?.todayCheckins ?? 0)}
              onPress={() => router.push("/(tabs)/bookings?filter=checkin")}
            />
            <StatCard
              icon="log-out"
              iconColor={C.checkout}
              iconBg={C.warningLight}
              label="Today's Check-outs"
              value={String(statsQuery.data?.todayCheckouts ?? 0)}
              onPress={() => router.push("/(tabs)/bookings?filter=checkout")}
            />
          </View>

          <View style={styles.statsRow}>
            <StatCard
              icon="calendar"
              iconColor={C.accent}
              iconBg={C.accentLight}
              label="Total Bookings"
              value={String(statsQuery.data?.totalBookings ?? 0)}
            />
            <StatCard
              icon="dollar-sign"
              iconColor={C.success}
              iconBg={C.successLight}
              label="Monthly Revenue"
              value={`$${(statsQuery.data?.monthlyRevenue ?? 0).toLocaleString()}`}
            />
          </View>

          <View style={styles.occupancyCard}>
            <View style={styles.occupancyHeader}>
              <Text style={styles.sectionTitle}>Occupancy</Text>
              <View style={[styles.occupancyBadge, { backgroundColor: occupancyColor(statsQuery.data?.occupancyPercentage ?? 0) + "20" }]}>
                <Text style={[styles.occupancyPct, { color: occupancyColor(statsQuery.data?.occupancyPercentage ?? 0) }]}>
                  {statsQuery.data?.occupancyPercentage ?? 0}%
                </Text>
              </View>
            </View>
            <View style={styles.progressBg}>
              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${Math.min(statsQuery.data?.occupancyPercentage ?? 0, 100)}%`,
                    backgroundColor: occupancyColor(statsQuery.data?.occupancyPercentage ?? 0),
                  },
                ]}
              />
            </View>
            <Text style={styles.occupancyDetail}>
              {statsQuery.data?.occupiedRooms ?? 0} occupied / {statsQuery.data?.totalRooms ?? 0} total rooms
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Today's Check-ins</Text>
          {checkinsQuery.data?.length === 0 ? (
            <EmptyState icon="log-in" message="No check-ins today" />
          ) : (
            checkinsQuery.data?.slice(0, 5).map((b) => (
              <BookingRow key={b.id} booking={b} type="checkin" />
            ))
          )}

          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Today's Check-outs</Text>
          {checkoutsQuery.data?.length === 0 ? (
            <EmptyState icon="log-out" message="No check-outs today" />
          ) : (
            checkoutsQuery.data?.slice(0, 5).map((b) => (
              <BookingRow key={b.id} booking={b} type="checkout" />
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function Platform_isWeb() {
  const { Platform } = require("react-native");
  return Platform.OS === "web";
}

function occupancyColor(pct: number) {
  if (pct >= 80) return Colors.light.danger;
  if (pct >= 60) return Colors.light.warning;
  return Colors.light.success;
}

function StatCard({ icon, iconColor, iconBg, label, value, onPress }: {
  icon: string; iconColor: string; iconBg: string; label: string; value: string; onPress?: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.statCard, pressed && onPress && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <View style={[styles.statIcon, { backgroundColor: iconBg }]}>
        <Feather name={icon as any} size={22} color={iconColor} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {onPress && <Feather name="chevron-right" size={14} color={C.textSecondary} style={styles.statArrow} />}
    </Pressable>
  );
}

function BookingRow({ booking, type }: { booking: Booking; type: "checkin" | "checkout" }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.bookingRow, pressed && { opacity: 0.85 }]}
      onPress={() => router.push(`/booking/${booking.id}` as any)}
    >
      <View style={[styles.bookingDot, { backgroundColor: type === "checkin" ? C.checkin : C.checkout }]} />
      <View style={styles.bookingInfo}>
        <Text style={styles.guestName}>{booking.guestName}</Text>
        <Text style={styles.roomInfo}>{booking.roomNumber ? `Room ${booking.roomNumber}` : booking.roomType ?? "—"}</Text>
      </View>
      <View style={styles.bookingRight}>
        {booking.balance > 0 && (
          <Text style={styles.balanceDue}>-${booking.balance.toFixed(0)} due</Text>
        )}
        <Feather name="chevron-right" size={16} color={C.textSecondary} />
      </View>
    </Pressable>
  );
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Feather name={icon as any} size={24} color={C.border} />
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  greeting: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
  userName: { fontFamily: "Inter_700Bold", fontSize: 26, color: C.text, letterSpacing: -0.5 },
  date: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, marginTop: 2 },
  headerRight: { alignItems: "flex-end", gap: 8 },
  roleBadge: { backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#fff", letterSpacing: 1 },
  logoutBtn: { padding: 6 },
  hotelBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  hotelName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff", flex: 1 },
  hotelRooms: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.7)" },
  loadingBox: { height: 300, justifyContent: "center", alignItems: "center" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  statCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
    gap: 8,
  },
  statIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 24, color: C.text, letterSpacing: -0.5 },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  statArrow: { position: "absolute", top: 16, right: 16 },
  occupancyCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  occupancyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  occupancyBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  occupancyPct: { fontFamily: "Inter_700Bold", fontSize: 16 },
  progressBg: { height: 8, backgroundColor: C.surfaceSecondary, borderRadius: 4, overflow: "hidden", marginBottom: 8 },
  progressBar: { height: "100%", borderRadius: 4 },
  occupancyDetail: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 17, color: C.text, marginBottom: 12, letterSpacing: -0.3 },
  bookingRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowColor: C.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 1,
  },
  bookingDot: { width: 8, height: 8, borderRadius: 4, marginRight: 12 },
  bookingInfo: { flex: 1 },
  guestName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  roomInfo: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  bookingRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  balanceDue: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.danger },
  emptyState: { alignItems: "center", gap: 8, padding: 24 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
});
