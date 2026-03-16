import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
  hotelId: number;
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
  const [showPayment, setShowPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Booking> & { agencyId?: number | null }>({});

  const { data: booking, isLoading } = useQuery<Booking>({
    queryKey: ["booking", id],
    queryFn: () => api.get<Booking>(`/bookings/${id}`),
    enabled: !!id,
  });

  const paymentMutation = useMutation({
    mutationFn: (receipt: number) => api.patch(`/bookings/${id}/payment`, { receipt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      setShowPayment(false);
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.put(`/bookings/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      setShowEdit(false);
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/bookings/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      router.back();
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function openEdit() {
    if (!booking) return;
    setEditForm({
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      guestPhone: booking.guestPhone,
      roomNumber: booking.roomNumber,
      roomType: booking.roomType,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      roomRent: booking.roomRent,
      addOns: booking.addOns,
      receipt: booking.receipt,
      notes: booking.notes,
      status: booking.status,
      agencyId: booking.agencyId,
    });
    setShowEdit(true);
  }

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

  function submitPayment() {
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount < 0) { Alert.alert("Error", "Enter a valid amount"); return; }
    paymentMutation.mutate(amount);
  }

  const totalCostCalc = editForm.roomRent !== undefined && editForm.addOns !== undefined
    ? Number(editForm.roomRent) + Number(editForm.addOns)
    : booking?.totalCost ?? 0;
  const balanceCalc = totalCostCalc - Number(editForm.receipt ?? booking?.receipt ?? 0);

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()}><Feather name="arrow-left" size={22} color={C.text} /></Pressable>
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
          <Pressable style={styles.iconBtn} onPress={openEdit}><Feather name="edit-2" size={18} color={C.accent} /></Pressable>
          {(user?.role === "admin" || user?.role === "owner") && (
            <Pressable style={[styles.iconBtn, { backgroundColor: C.dangerLight }]} onPress={confirmDelete}>
              <Feather name="trash-2" size={18} color={C.danger} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>
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
            <Text style={[styles.statusText, { color: STATUS_COLORS[booking.status] }]}>{booking.status.replace("_", " ")}</Text>
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

        {(booking.roomNumber || booking.roomType || booking.agency || booking.hotel) && (
          <InfoSection>
            {booking.hotel && <InfoRow icon="home" label="Hotel" value={booking.hotel.name} />}
            {booking.roomNumber && <InfoRow icon="hash" label="Room" value={booking.roomNumber} />}
            {booking.roomType && <InfoRow icon="layers" label="Type" value={booking.roomType} />}
            {booking.agency && <InfoRow icon="briefcase" label="Agency" value={booking.agency.name} />}
            {booking.notes && <InfoRow icon="file-text" label="Notes" value={booking.notes} />}
          </InfoSection>
        )}

        <View style={styles.financialCard}>
          <Text style={styles.financialTitle}>Financial Summary</Text>
          <FinRow label="Room Rent" value={`$${booking.roomRent.toFixed(2)}`} />
          <FinRow label="Add-ons" value={`$${booking.addOns.toFixed(2)}`} />
          <View style={styles.divider} />
          <FinRow label="Total Cost" value={`$${booking.totalCost.toFixed(2)}`} bold />
          <FinRow label="Receipt" value={`$${booking.receipt.toFixed(2)}`} color={C.success} />
          <FinRow label="Balance Due" value={`$${booking.balance.toFixed(2)}`} color={booking.balance > 0 ? C.danger : C.success} bold />
        </View>

        {booking.balance !== 0 && (
          <Pressable
            style={({ pressed }) => [styles.paymentBtn, pressed && { opacity: 0.85 }]}
            onPress={() => { setPaymentAmount(String(booking.balance)); setShowPayment(true); }}
          >
            <Feather name="dollar-sign" size={20} color="#fff" />
            <Text style={styles.paymentBtnText}>Update Payment</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal visible={showPayment} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Update Payment</Text>
              <Pressable onPress={() => setShowPayment(false)}><Feather name="x" size={22} color={C.text} /></Pressable>
            </View>
            <Text style={styles.modalSub}>Total: ${booking.totalCost.toFixed(2)} • Current receipt: ${booking.receipt.toFixed(2)}</Text>
            <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8, marginTop: 16 }}>New Total Receipt Amount</Text>
            <TextInput
              style={styles.payInput}
              value={paymentAmount}
              onChangeText={setPaymentAmount}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor={C.textSecondary}
            />
            <Pressable
              style={[styles.submitBtn, paymentMutation.isPending && { opacity: 0.6 }]}
              onPress={submitPayment}
              disabled={paymentMutation.isPending}
            >
              {paymentMutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.submitText}>Save Payment</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showEdit} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalContent, { paddingBottom: insets.bottom + 16, maxHeight: "92%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Booking</Text>
              <Pressable onPress={() => setShowEdit(false)}><Feather name="x" size={22} color={C.text} /></Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <EditField label="Guest Name" value={String(editForm.guestName ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, guestName: v }))} />
              <EditField label="Email" value={String(editForm.guestEmail ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, guestEmail: v }))} keyboardType="email-address" />
              <EditField label="Phone" value={String(editForm.guestPhone ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, guestPhone: v }))} keyboardType="phone-pad" />
              <EditField label="Room Number" value={String(editForm.roomNumber ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, roomNumber: v }))} />
              <EditField label="Room Type" value={String(editForm.roomType ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, roomType: v }))} />
              <EditField label="Check-In (YYYY-MM-DD)" value={String(editForm.checkIn ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, checkIn: v }))} />
              <EditField label="Check-Out (YYYY-MM-DD)" value={String(editForm.checkOut ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, checkOut: v }))} />
              <EditField label="Room Rent ($)" value={String(editForm.roomRent ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, roomRent: parseFloat(v) || 0 }))} keyboardType="numeric" />
              <EditField label="Add-ons ($)" value={String(editForm.addOns ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, addOns: parseFloat(v) || 0 }))} keyboardType="numeric" />
              <EditField label="Receipt ($)" value={String(editForm.receipt ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, receipt: parseFloat(v) || 0 }))} keyboardType="numeric" />
              <View style={styles.calcRow}>
                <Text style={styles.calcLabel}>Total Cost: </Text><Text style={styles.calcValue}>${totalCostCalc.toFixed(2)}</Text>
                <Text style={[styles.calcLabel, { marginLeft: 16 }]}>Balance: </Text>
                <Text style={[styles.calcValue, { color: balanceCalc > 0 ? C.danger : C.success }]}>${balanceCalc.toFixed(2)}</Text>
              </View>
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8 }}>Status</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {["confirmed", "checked_in", "checked_out", "cancelled"].map((s) => (
                    <Pressable
                      key={s}
                      style={[styles.statusPicker, editForm.status === s && { backgroundColor: STATUS_COLORS[s] }]}
                      onPress={() => setEditForm((f) => ({ ...f, status: s as any }))}
                    >
                      <Text style={[styles.statusPickerText, editForm.status === s && { color: "#fff" }]}>{s.replace("_", " ")}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <EditField label="Notes" value={String(editForm.notes ?? "")} onChangeText={(v) => setEditForm((f) => ({ ...f, notes: v }))} multiline />
              <Pressable
                style={[styles.submitBtn, updateMutation.isPending && { opacity: 0.6 }]}
                onPress={() => updateMutation.mutate(editForm)}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>Save Changes</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function InfoSection({ children }: { children: React.ReactNode }) {
  return <View style={styles.infoSection}>{children}</View>;
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
function EditField({ label, value, onChangeText, keyboardType, multiline }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.textSecondary, marginBottom: 4 }}>{label}</Text>
      <TextInput
        style={[{ borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 10, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, backgroundColor: C.surfaceSecondary }, multiline && { height: 80, textAlignVertical: "top" }]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize="none"
        multiline={multiline}
      />
    </View>
  );
}
function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
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
  dateValue: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text, textAlign: "center" },
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
  paymentBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, marginBottom: 16 },
  paymentBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
  calcRow: { flexDirection: "row", alignItems: "center", backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 12, marginBottom: 14 },
  calcLabel: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textSecondary },
  calcValue: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text },
  statusPicker: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.surfaceSecondary },
  statusPickerText: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.textSecondary, textTransform: "capitalize" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  modalSub: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  payInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 14, fontFamily: "Inter_700Bold", fontSize: 24, color: C.text, backgroundColor: C.surfaceSecondary, textAlign: "center", marginBottom: 16 },
  submitBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
