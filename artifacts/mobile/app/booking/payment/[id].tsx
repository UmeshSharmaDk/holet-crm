import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
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

const C = Colors.light;

interface Booking {
  id: number;
  guestName: string;
  roomRent: number;
  addOns: number;
  totalCost: number;
  receipt: number;
  balance: number;
}

export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");

  const { data: booking, isLoading } = useQuery<Booking>({
    queryKey: ["booking", id],
    queryFn: () => api.get<Booking>(`/bookings/${id}`),
    enabled: !!id,
    onSuccess: (b) => setAmount(String(b.receipt)),
  } as any);

  const mutation = useMutation({
    mutationFn: (receipt: number) => api.patch(`/bookings/${id}/payment`, { receipt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["booking", id] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      router.back();
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function submit() {
    const value = parseFloat(amount);
    if (isNaN(value) || value < 0) { Alert.alert("Error", "Enter a valid amount"); return; }
    mutation.mutate(value);
  }

  const newBalance = booking ? booking.totalCost - (parseFloat(amount) || 0) : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.topTitle}>Update Payment</Text>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.summaryCard}>
              <Text style={styles.guestName}>{booking?.guestName}</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Room Rent</Text>
                <Text style={styles.summaryValue}>${booking?.roomRent.toFixed(2)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Add-ons</Text>
                <Text style={styles.summaryValue}>${booking?.addOns.toFixed(2)}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { fontFamily: "Inter_700Bold", color: C.text }]}>Total Cost</Text>
                <Text style={[styles.summaryValue, { fontFamily: "Inter_700Bold", color: C.text }]}>${booking?.totalCost.toFixed(2)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Current Receipt</Text>
                <Text style={[styles.summaryValue, { color: C.success }]}>${booking?.receipt.toFixed(2)}</Text>
              </View>
            </View>

            <Text style={styles.fieldLabel}>New Total Receipt Amount</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor={C.textSecondary}
              autoFocus
            />

            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>New Balance Due</Text>
              <Text style={[styles.balanceValue, { color: newBalance > 0 ? C.danger : C.success }]}>
                ${newBalance.toFixed(2)}
              </Text>
              {newBalance <= 0 && (
                <View style={styles.paidBadge}>
                  <Feather name="check-circle" size={14} color={C.success} />
                  <Text style={styles.paidText}>Fully paid</Text>
                </View>
              )}
            </View>

            <Pressable
              style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.85 }, mutation.isPending && { opacity: 0.6 }]}
              onPress={submit}
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? <ActivityIndicator color="#fff" size="small" />
                : <><Feather name="check" size={20} color="#fff" /><Text style={styles.submitText}>Save Payment</Text></>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  summaryCard: { backgroundColor: C.surface, borderRadius: 16, padding: 20, marginBottom: 28, shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  guestName: { fontFamily: "Inter_700Bold", fontSize: 18, color: C.text, marginBottom: 16 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  summaryLabel: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary },
  summaryValue: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 8 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text, marginBottom: 10 },
  amountInput: { borderWidth: 2, borderColor: C.accent, borderRadius: 14, padding: 20, fontFamily: "Inter_700Bold", fontSize: 32, color: C.text, backgroundColor: C.surface, textAlign: "center", marginBottom: 20 },
  balanceCard: { backgroundColor: C.surfaceSecondary, borderRadius: 14, padding: 16, alignItems: "center", gap: 4, marginBottom: 28 },
  balanceLabel: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  balanceValue: { fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.5 },
  paidBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  paidText: { fontFamily: "Inter_500Medium", fontSize: 12, color: C.success },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 18 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
