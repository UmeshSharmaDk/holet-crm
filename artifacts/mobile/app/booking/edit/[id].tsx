import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import { api } from "@/lib/api";
import { DatePickerField } from "@/components/DatePickerField";

const C = Colors.light;

const STATUS_LIST = ["confirmed", "checked_in", "checked_out", "cancelled"] as const;
const STATUS_COLORS: Record<string, string> = {
  confirmed: C.accent,
  checked_in: C.success,
  checked_out: C.textSecondary,
  cancelled: C.danger,
};

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
  status: string;
  notes: string | null;
  agencyId: number | null;
}

interface Agency { id: number; name: string; }

export default function EditBookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    guestName: "",
    guestEmail: "",
    guestPhone: "",
    roomNumber: "",
    roomType: "",
    checkIn: "",
    checkOut: "",
    roomRent: "",
    addOns: "",
    receipt: "",
    notes: "",
    status: "confirmed",
    agencyId: "",
  });

  const { data: booking, isLoading } = useQuery<Booking>({
    queryKey: ["booking", id],
    queryFn: () => api.get<Booking>(`/bookings/${id}`),
    enabled: !!id,
  });

  const { data: agencies } = useQuery<Agency[]>({
    queryKey: ["agencies"],
    queryFn: () => api.get<Agency[]>("/agencies"),
  });

  useEffect(() => {
    if (booking) {
      setForm({
        guestName: booking.guestName,
        guestEmail: booking.guestEmail ?? "",
        guestPhone: booking.guestPhone ?? "",
        roomNumber: booking.roomNumber ?? "",
        roomType: booking.roomType ?? "",
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        roomRent: String(booking.roomRent),
        addOns: String(booking.addOns),
        receipt: String(booking.receipt),
        notes: booking.notes ?? "",
        status: booking.status,
        agencyId: booking.agencyId ? String(booking.agencyId) : "",
      });
    }
  }, [booking]);

  const mutation = useMutation({
    mutationFn: (data: any) => api.put(`/bookings/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      router.back();
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function update(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const roomRent = parseFloat(form.roomRent) || 0;
  const addOns = parseFloat(form.addOns) || 0;
  const receipt = parseFloat(form.receipt) || 0;
  const totalCost = roomRent + addOns;
  const balance = totalCost - receipt;

  function submit() {
    if (!form.guestName.trim()) { Alert.alert("Error", "Guest name is required"); return; }
    mutation.mutate({
      guestName: form.guestName.trim(),
      guestEmail: form.guestEmail.trim() || null,
      guestPhone: form.guestPhone.trim() || null,
      roomNumber: form.roomNumber.trim() || null,
      roomType: form.roomType.trim() || null,
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      roomRent,
      addOns,
      receipt,
      notes: form.notes.trim() || null,
      status: form.status,
      agencyId: form.agencyId ? parseInt(form.agencyId) : null,
    });
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TopBar title="Edit Booking" />
        <View style={styles.centered}><ActivityIndicator size="large" color={C.accent} /></View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar title={`Edit Booking #${id}`} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

          <SectionHeader title="Guest Information" />
          <FormField label="Guest Name *" value={form.guestName} onChangeText={(v) => update("guestName", v)} placeholder="John Smith" />
          <FormField label="Email" value={form.guestEmail} onChangeText={(v) => update("guestEmail", v)} placeholder="john@email.com" keyboardType="email-address" />
          <FormField label="Phone" value={form.guestPhone} onChangeText={(v) => update("guestPhone", v)} placeholder="+1 234 567 8900" keyboardType="phone-pad" />

          <SectionHeader title="Room Details" />
          <Row>
            <FormField label="Room Number" value={form.roomNumber} onChangeText={(v) => update("roomNumber", v)} placeholder="101" flex />
            <FormField label="Room Type" value={form.roomType} onChangeText={(v) => update("roomType", v)} placeholder="Deluxe" flex />
          </Row>

          <SectionHeader title="Dates" />
          <DatePickerField
            label="Check-In"
            value={form.checkIn}
            onChange={(v) => update("checkIn", v)}
          />
          <DatePickerField
            label="Check-Out"
            value={form.checkOut}
            onChange={(v) => update("checkOut", v)}
            minimumDate={form.checkIn ? new Date(new Date(form.checkIn).getTime() + 86400000) : undefined}
          />

          <SectionHeader title="Financials" />
          <Row>
            <FormField label="Room Rent (₹)" value={form.roomRent} onChangeText={(v) => update("roomRent", v)} placeholder="0.00" keyboardType="numeric" flex />
            <FormField label="Add-ons (₹)" value={form.addOns} onChangeText={(v) => update("addOns", v)} placeholder="0.00" keyboardType="numeric" flex />
          </Row>
          <FormField label="Receipt (₹)" value={form.receipt} onChangeText={(v) => update("receipt", v)} placeholder="0.00" keyboardType="numeric" />

          <View style={styles.calcCard}>
            <CalcRow label="Total Cost" value={`₹${totalCost.toFixed(2)}`} />
            <CalcRow label="Balance Due" value={`₹${balance.toFixed(2)}`} valueColor={balance > 0 ? C.danger : C.success} />
          </View>

          <SectionHeader title="Status" />
          <View style={styles.chipRow}>
            {STATUS_LIST.map((s) => (
              <Pressable
                key={s}
                style={[styles.chip, form.status === s && { backgroundColor: STATUS_COLORS[s] }]}
                onPress={() => update("status", s)}
              >
                <Text style={[styles.chipText, form.status === s && { color: "#fff" }]}>{s.replace("_", " ")}</Text>
              </Pressable>
            ))}
          </View>

          <SectionHeader title="Agency" />
          <View style={styles.chipRow}>
            <Pressable style={[styles.chip, !form.agencyId && styles.chipActive]} onPress={() => update("agencyId", "")}>
              <Text style={[styles.chipText, !form.agencyId && styles.chipTextActive]}>Direct</Text>
            </Pressable>
            {(agencies ?? []).map((a) => (
              <Pressable key={a.id} style={[styles.chip, form.agencyId === String(a.id) && styles.chipActive]} onPress={() => update("agencyId", String(a.id))}>
                <Text style={[styles.chipText, form.agencyId === String(a.id) && styles.chipTextActive]}>{a.name}</Text>
              </Pressable>
            ))}
          </View>

          <SectionHeader title="Notes" />
          <TextInput
            style={styles.textArea}
            value={form.notes}
            onChangeText={(v) => update("notes", v)}
            placeholder="Special requests, notes..."
            placeholderTextColor={C.textSecondary}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <Pressable
            style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.85 }, mutation.isPending && { opacity: 0.6 }]}
            onPress={submit}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.submitText}>Save Changes</Text>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function TopBar({ title }: { title: string }) {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={22} color={C.text} />
      </Pressable>
      <Text style={styles.topTitle}>{title}</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionLine} />
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: "row", gap: 12 }}>{children}</View>;
}

function CalcRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.calcRow}>
      <Text style={styles.calcLabel}>{label}</Text>
      <Text style={[styles.calcValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

function FormField({ label, value, onChangeText, placeholder, keyboardType, flex }: any) {
  return (
    <View style={[styles.field, flex && { flex: 1 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.textSecondary}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text, letterSpacing: -0.3 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 20, marginBottom: 12 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 13, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  sectionLine: { flex: 1, height: 1, backgroundColor: C.border },
  field: { marginBottom: 14 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 6 },
  fieldInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 14, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, backgroundColor: C.surface },
  calcCard: { backgroundColor: C.primary, borderRadius: 14, padding: 16, marginBottom: 4, gap: 8 },
  calcRow: { flexDirection: "row", justifyContent: "space-between" },
  calcLabel: { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.75)" },
  calcValue: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: C.surfaceSecondary },
  chipActive: { backgroundColor: C.primary },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, textTransform: "capitalize" },
  chipTextActive: { color: "#fff" },
  textArea: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 14, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, backgroundColor: C.surface, minHeight: 90, textAlignVertical: "top", marginBottom: 4 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 18, marginTop: 20 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
