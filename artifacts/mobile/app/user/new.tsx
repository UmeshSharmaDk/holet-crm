import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
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

interface Hotel { id: number; name: string; }

export default function NewUserScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "manager", hotelId: "" });

  const { data: hotels } = useQuery<Hotel[]>({
    queryKey: ["hotels"],
    queryFn: () => api.get<Hotel[]>("/hotels"),
  });

  const mutation = useMutation({
    mutationFn: (data: any) => api.post("/users", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      router.back();
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function submit() {
    if (!form.name.trim()) { Alert.alert("Error", "Name is required"); return; }
    if (!form.email.trim()) { Alert.alert("Error", "Email is required"); return; }
    if (!form.password) { Alert.alert("Error", "Password is required"); return; }
    mutation.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      hotelId: form.hotelId ? parseInt(form.hotelId) : null,
    });
  }

  const ROLE_COLORS: Record<string, string> = { admin: C.danger, owner: C.gold, manager: C.accent };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.topTitle}>New User</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FormField label="Full Name *" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Jane Doe" />
          <FormField label="Email *" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="jane@hotel.com" keyboardType="email-address" />
          <FormField label="Password *" value={form.password} onChangeText={(v) => setForm((f) => ({ ...f, password: v }))} placeholder="••••••••" secureTextEntry />

          <Text style={styles.sectionLabel}>Role *</Text>
          <View style={styles.chipRow}>
            {["admin", "owner", "manager"].map((r) => (
              <Pressable
                key={r}
                style={[styles.chip, form.role === r && { backgroundColor: ROLE_COLORS[r] }]}
                onPress={() => setForm((f) => ({ ...f, role: r }))}
              >
                <Text style={[styles.chipText, form.role === r && { color: "#fff" }]}>{r}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Assign Hotel</Text>
          <View style={styles.chipRow}>
            <Pressable style={[styles.chip, !form.hotelId && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, hotelId: "" }))}>
              <Text style={[styles.chipText, !form.hotelId && styles.chipTextActive]}>None</Text>
            </Pressable>
            {(hotels ?? []).map((h) => (
              <Pressable key={h.id} style={[styles.chip, form.hotelId === String(h.id) && styles.chipActive]} onPress={() => setForm((f) => ({ ...f, hotelId: String(h.id) }))}>
                <Text style={[styles.chipText, form.hotelId === String(h.id) && styles.chipTextActive]}>{h.name}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.85 }, mutation.isPending && { opacity: 0.6 }]}
            onPress={submit}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? <ActivityIndicator color="#fff" size="small" />
              : <><Feather name="user-plus" size={20} color="#fff" /><Text style={styles.submitText}>Create User</Text></>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FormField({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry }: any) {
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
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  field: { marginBottom: 16 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8 },
  fieldInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 14, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, backgroundColor: C.surface },
  sectionLabel: { fontFamily: "Inter_700Bold", fontSize: 13, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10, marginTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  chip: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.surfaceSecondary },
  chipActive: { backgroundColor: C.primary },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, textTransform: "capitalize" },
  chipTextActive: { color: "#fff" },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 18, marginTop: 8 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
