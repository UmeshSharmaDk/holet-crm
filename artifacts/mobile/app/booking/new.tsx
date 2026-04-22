import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState, useMemo } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { DatePickerField } from "@/components/DatePickerField";

const C = Colors.light;

interface Agency { id: number; name: string; }

export default function NewBookingScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  const [form, setForm] = useState({
    guestName: "",
    guestEmail: "",
    guestPhone: "",
    numberOfRooms: "1",
    numberOfPersons: "1",
    checkIn: today,
    checkOut: tomorrow,
    roomRent: "",
    addOns: "0",
    receipt: "0",
    notes: "",
    status: "confirmed" as "confirmed" | "checked_in",
    agencyId: "" as string,
  });

  const { data: agencies } = useQuery<Agency[]>({
    queryKey: ["agencies"],
    queryFn: () => api.get<Agency[]>("/agencies"),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post("/bookings", data),
    onSuccess: (booking: any) => {
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
      router.replace(`/booking/${booking.id}` as any);
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const roomRent = parseFloat(form.roomRent) || 0;
  const addOns = parseFloat(form.addOns) || 0;
  const receipt = parseFloat(form.receipt) || 0;
  const totalCost = roomRent + addOns;
  const balance = totalCost - receipt;

  const nights = useMemo(() => {
    try {
      const diff = new Date(form.checkOut).getTime() - new Date(form.checkIn).getTime();
      return Math.max(1, Math.ceil(diff / 86400000));
    } catch { return 0; }
  }, [form.checkIn, form.checkOut]);

  function submit() {
    if (!form.guestName.trim()) { Alert.alert("Error", "Guest name is required"); return; }
    if (!form.checkIn || !form.checkOut) { Alert.alert("Error", "Dates are required"); return; }
    if (!form.roomRent) { Alert.alert("Error", "Room rent is required"); return; }

    createMutation.mutate({
      guestName: form.guestName.trim(),
      guestEmail: form.guestEmail.trim() || null,
      guestPhone: form.guestPhone.trim() || null,
      numberOfRooms: parseInt(form.numberOfRooms) || 1,
      numberOfPersons: parseInt(form.numberOfPersons) || 1,
      checkIn: form.checkIn,
      checkOut: form.checkOut,
      roomRent,
      addOns,
      receipt,
      notes: form.notes.trim() || null,
      status: form.status,
      hotelId: user?.hotelId,
      agencyId: form.agencyId ? parseInt(form.agencyId) : null,
    });
  }

  function update(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.topTitle}>New Booking</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>

        <SectionHeader title="Guest Information" />
        <FormField label="Guest Name *" value={form.guestName} onChangeText={(v) => update("guestName", v)} placeholder="John Smith" />
        <FormField label="Email" value={form.guestEmail} onChangeText={(v) => update("guestEmail", v)} placeholder="john@email.com" keyboardType="email-address" />
        <FormField label="Phone" value={form.guestPhone} onChangeText={(v) => update("guestPhone", v)} placeholder="+1 234 567 8900" keyboardType="phone-pad" />

        <SectionHeader title="Room Details" />
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <FormField label="Number of Rooms" value={form.numberOfRooms} onChangeText={(v) => update("numberOfRooms", v)} placeholder="1" keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <FormField label="Number of Persons" value={form.numberOfPersons} onChangeText={(v) => update("numberOfPersons", v)} placeholder="1" keyboardType="numeric" />
          </View>
        </View>

        <SectionHeader title="Dates" />
        <DatePickerField
          label="Check-In *"
          value={form.checkIn}
          onChange={(v) => update("checkIn", v)}
        />
        <DatePickerField
          label="Check-Out *"
          value={form.checkOut}
          onChange={(v) => update("checkOut", v)}
          minimumDate={form.checkIn ? new Date(new Date(form.checkIn).getTime() + 86400000) : undefined}
        />
        {nights > 0 && (
          <View style={styles.nightsBadge}>
            <Feather name="moon" size={14} color={C.accent} />
            <Text style={styles.nightsText}>{nights} night{nights !== 1 ? "s" : ""}</Text>
          </View>
        )}

        <SectionHeader title="Financials" />
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <FormField label="Room Rent (₹) *" value={form.roomRent} onChangeText={(v) => update("roomRent", v)} placeholder="0.00" keyboardType="numeric" />
          </View>
          <View style={{ flex: 1 }}>
            <FormField label="Add-ons (₹)" value={form.addOns} onChangeText={(v) => update("addOns", v)} placeholder="0.00" keyboardType="numeric" />
          </View>
        </View>
        <FormField label="Receipt (₹)" value={form.receipt} onChangeText={(v) => update("receipt", v)} placeholder="0.00" keyboardType="numeric" />

        <View style={styles.calcCard}>
          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>Total Cost</Text>
            <Text style={styles.calcValue}>₹{totalCost.toFixed(2)}</Text>
          </View>
          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>Balance Due</Text>
            <Text style={[styles.calcValue, { color: balance > 0 ? C.danger : C.success }]}>₹{balance.toFixed(2)}</Text>
          </View>
        </View>

        <SectionHeader title="Additional" />
        <View style={{ marginBottom: 16 }}>
          <Text style={styles.fieldLabel}>Travel Agency</Text>
          <View style={styles.agencyPicker}>
            <Pressable
              style={[styles.agencyOption, !form.agencyId && styles.agencyOptionActive]}
              onPress={() => update("agencyId", "")}
            >
              <Text style={[styles.agencyOptionText, !form.agencyId && styles.agencyOptionTextActive]}>Direct</Text>
            </Pressable>
            {(agencies ?? []).map((a) => (
              <Pressable
                key={a.id}
                style={[styles.agencyOption, form.agencyId === String(a.id) && styles.agencyOptionActive]}
                onPress={() => update("agencyId", String(a.id))}
              >
                <Text style={[styles.agencyOptionText, form.agencyId === String(a.id) && styles.agencyOptionTextActive]}>{a.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.statusPicker}>
            {["confirmed", "checked_in"].map((s) => (
              <Pressable
                key={s}
                style={[styles.statusOption, form.status === s && styles.statusOptionActive]}
                onPress={() => update("status", s)}
              >
                <Text style={[styles.statusOptionText, form.status === s && styles.statusOptionTextActive]}>{s.replace("_", " ")}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ marginBottom: 16 }}>
          <Text style={styles.fieldLabel}>Notes</Text>
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
        </View>

        <Pressable
          style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.85 }, createMutation.isPending && { opacity: 0.6 }]}
          onPress={submit}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending
            ? <ActivityIndicator color="#fff" size="small" />
            : <><Feather name="plus" size={20} color="#fff" /><Text style={styles.submitText}>Create Booking</Text></>}
        </Pressable>
      </ScrollView>
    </View>
    </KeyboardAvoidingView>
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

function FormField({ label, value, onChangeText, placeholder, keyboardType }: any) {
  return (
    <View style={styles.field}>
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
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text },
  content: { paddingHorizontal: 16 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 20, marginBottom: 12 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8 },
  sectionLine: { flex: 1, height: 1, backgroundColor: C.border },
  row2: { flexDirection: "row", gap: 10 },
  field: { marginBottom: 14 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 6 },
  fieldInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, backgroundColor: C.surface },
  nightsBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.accentLight, alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8 },
  nightsText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.accent },
  calcCard: { backgroundColor: C.primary, borderRadius: 12, padding: 14, marginBottom: 8, gap: 8 },
  calcRow: { flexDirection: "row", justifyContent: "space-between" },
  calcLabel: { fontFamily: "Inter_400Regular", fontSize: 13, color: "rgba(255,255,255,0.75)" },
  calcValue: { fontFamily: "Inter_700Bold", fontSize: 15, color: "#fff" },
  agencyPicker: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  agencyOption: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.surfaceSecondary },
  agencyOptionActive: { backgroundColor: C.primary },
  agencyOptionText: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },
  agencyOptionTextActive: { color: "#fff" },
  statusPicker: { flexDirection: "row", gap: 8 },
  statusOption: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: C.surfaceSecondary },
  statusOptionActive: { backgroundColor: C.success },
  statusOptionText: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, textTransform: "capitalize" },
  statusOptionTextActive: { color: "#fff" },
  textArea: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, backgroundColor: C.surface, minHeight: 80 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 18, marginTop: 8, marginBottom: 8 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
