import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

const C = Colors.light;

interface Booking {
  id: number;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  roomNumber: string | null;
  roomType: string | null;
  checkIn: string;
  checkOut: string;
  roomRent: number;
  addOns: number;
  totalCost: number;
  receipt: number;
  balance: number;
  status: "confirmed" | "checked_in" | "checked_out" | "cancelled";
  notes: string | null;
  agencyId: number | null;
  agency?: { id: number; name: string } | null;
  hotel?: { id: number; name: string; totalRooms: number } | null;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: C.accent,
  checked_in: C.success,
  checked_out: C.textSecondary,
  cancelled: C.danger,
};

export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: booking, isLoading } = useQuery<Booking>({
    queryKey: ["booking", id],
    queryFn: () => api.get<Booking>(`/bookings/${id}`),
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/bookings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      router.back();
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function confirmDelete() {
    if (user?.role !== "admin" && user?.role !== "owner") {
      Alert.alert("Permission Denied", "Only Owners and Admins can delete bookings.");
      return;
    }
    Alert.alert("Delete Booking", `Delete booking for "${booking?.guestName}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate() },
    ]);
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={C.text} />
          </Pressable>
        </View>
        <View style={styles.centered}><ActivityIndicator size="large" color={C.accent} /></View>
      </View>
    );
  }

  if (!booking) return null;

  const nights = Math.ceil((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.topTitle}>Booking #{booking.id}</Text>
        <View style={styles.topActions}>
          <Pressable style={styles.iconBtn} onPress={() => router.push(`/booking/edit/${id}` as any)}>
            <Feather name="edit-2" size={18} color={C.accent} />
          </Pressable>
          {(user?.role === "admin" || user?.role === "owner") && (
            <Pressable style={[styles.iconBtn, { backgroundColor: C.dangerLight }]} onPress={confirmDelete}>
              <Feather name="trash-2" size={18} color={C.danger} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.guestCard}>
          <View style={styles.guestAvatar}>
            <Text style={styles.guestInitial}>{booking.guestName.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.guestName}>{booking.guestName}</Text>
            {booking.guestEmail && <Text style={styles.guestContact}>{booking.guestEmail}</Text>}
            {booking.guestPhone && <Text style={styles.guestContact}>{booking.guestPhone}</Text>}
          </View>
          <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[booking.status] + "20" }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[booking.status] }]}>
              {booking.status.replace("_", " ")}
            </Text>
          </View>
        </View>

        <View style={styles.datesRow}>
          <View style={styles.dateBox}>
            <Feather name="log-in" size={18} color={C.checkin} />
            <Text style={styles.dateLabel}>Check-In</Text>
            <Text style={styles.dateValue}>{formatDate(booking.checkIn)}</Text>
          </View>
          <View style={styles.nightsBox}>
            <Feather name="moon" size={18} color={C.textSecondary} />
            <Text style={styles.nightsText}>{nights}n</Text>
          </View>
          <View style={styles.dateBox}>
            <Feather name="log-out" size={18} color={C.checkout} />
            <Text style={styles.dateLabel}>Check-Out</Text>
            <Text style={styles.dateValue}>{formatDate(booking.checkOut)}</Text>
          </View>
        </View>

        {(booking.roomNumber || booking.roomType || booking.agency || booking.hotel || booking.notes) && (
          <View style={styles.infoSection}>
            {booking.hotel && <InfoRow icon="home" label="Hotel" value={booking.hotel.name} />}
            {booking.roomNumber && <InfoRow icon="hash" label="Room" value={booking.roomNumber} />}
            {booking.roomType && <InfoRow icon="layers" label="Type" value={booking.roomType} />}
            {booking.agency && <InfoRow icon="briefcase" label="Agency" value={booking.agency.name} />}
            {booking.notes && <InfoRow icon="file-text" label="Notes" value={booking.notes} />}
          </View>
        )}

        <View style={styles.financialCard}>
          <Text style={styles.financialTitle}>Financial Summary</Text>
          <FinRow label="Room Rent" value={`$${booking.roomRent.toFixed(2)}`} />
          <FinRow label="Add-ons" value={`$${booking.addOns.toFixed(2)}`} />
          <View style={styles.divider} />
          <FinRow label="Total Cost" value={`$${booking.totalCost.toFixed(2)}`} bold />
          <FinRow label="Receipt" value={`$${booking.receipt.toFixed(2)}`} color={C.success} />
          <FinRow
            label="Balance Due"
            value={`$${booking.balance.toFixed(2)}`}
            color={booking.balance > 0 ? C.danger : C.success}
            bold
          />
        </View>

        <View style={styles.actionButtons}>
          <Pressable
            style={({ pressed }) => [styles.paymentBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(`/booking/payment/${id}` as any)}
          >
            <Feather name="dollar-sign" size={20} color="#fff" />
            <Text style={styles.paymentBtnText}>Update Payment</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Feather name={icon as any} size={15} color={C.textSecondary} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function FinRow({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <View style={styles.finRow}>
      <Text style={[styles.finLabel, bold && { fontFamily: "Inter_700Bold" }]}>{label}</Text>
      <Text style={[styles.finValue, bold && { fontFamily: "Inter_700Bold" }, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  topActions: { flexDirection: "row", gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center" },
  content: { paddingHorizontal: 16 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  guestCard: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 12, gap: 14, shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  guestAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: C.primary, justifyContent: "center", alignItems: "center" },
  guestInitial: { fontFamily: "Inter_700Bold", fontSize: 22, color: "#fff" },
  guestName: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text },
  guestContact: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, marginTop: 2 },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontFamily: "Inter_600SemiBold", fontSize: 12, textTransform: "capitalize" },
  datesRow: { flexDirection: "row", backgroundColor: C.surface, borderRadius: 16, overflow: "hidden", marginBottom: 12, shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  dateBox: { flex: 1, alignItems: "center", padding: 16, gap: 4 },
  dateLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary },
  dateValue: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, textAlign: "center" },
  nightsBox: { alignItems: "center", justifyContent: "center", padding: 16, gap: 4, borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.border },
  nightsText: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  infoSection: { backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 12, gap: 12, shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  infoLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textSecondary, width: 64 },
  infoValue: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, flex: 1 },
  financialCard: { backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  financialTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text, marginBottom: 14 },
  finRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  finLabel: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
  finValue: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
  actionButtons: { gap: 10 },
  paymentBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16 },
  paymentBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
