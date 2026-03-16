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

const C = Colors.light;

interface Agency { id: number; name: string; contactEmail: string | null; contactPhone: string | null; hotelId: number; }

export default function EditAgencyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", contactEmail: "", contactPhone: "" });

  const { data: agency, isLoading } = useQuery<Agency>({
    queryKey: ["agency", id],
    queryFn: () => api.get<Agency>(`/agencies/${id}`),
    enabled: !!id,
  });

  useEffect(() => {
    if (agency) {
      setForm({
        name: agency.name,
        contactEmail: agency.contactEmail ?? "",
        contactPhone: agency.contactPhone ?? "",
      });
    }
  }, [agency]);

  const mutation = useMutation({
    mutationFn: (data: any) => api.put(`/agencies/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agencies"] });
      qc.invalidateQueries({ queryKey: ["agency", id] });
      router.back();
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function submit() {
    if (!form.name.trim()) { Alert.alert("Error", "Agency name is required"); return; }
    mutation.mutate({
      name: form.name.trim(),
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
    });
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <TopBar />
        <View style={styles.centered}><ActivityIndicator size="large" color={C.accent} /></View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <FormField label="Agency Name *" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Grand Travel Agency" />
          <FormField label="Contact Email" value={form.contactEmail} onChangeText={(v) => setForm((f) => ({ ...f, contactEmail: v }))} placeholder="contact@agency.com" keyboardType="email-address" />
          <FormField label="Contact Phone" value={form.contactPhone} onChangeText={(v) => setForm((f) => ({ ...f, contactPhone: v }))} placeholder="+1 234 567 8900" keyboardType="phone-pad" />

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

function TopBar() {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={22} color={C.text} />
      </Pressable>
      <Text style={styles.topTitle}>Edit Agency</Text>
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
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40 },
  field: { marginBottom: 16 },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8 },
  fieldInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 14, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, backgroundColor: C.surface },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 18, marginTop: 12 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
