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

interface Hotel { id: number; name: string; totalRooms: number; }

export default function EditHotelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", totalRooms: "" });

  const { data: hotel, isLoading } = useQuery<Hotel>({
    queryKey: ["hotel", id],
    queryFn: () => api.get<Hotel>(`/hotels/${id}`),
    enabled: !!id,
  });

  useEffect(() => {
    if (hotel) setForm({ name: hotel.name, totalRooms: String(hotel.totalRooms) });
  }, [hotel]);

  const mutation = useMutation({
    mutationFn: (data: any) => api.put(`/hotels/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotels"] });
      qc.invalidateQueries({ queryKey: ["hotel", id] });
      router.back();
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function submit() {
    if (!form.name.trim()) { Alert.alert("Error", "Hotel name is required"); return; }
    if (!form.totalRooms || isNaN(parseInt(form.totalRooms))) { Alert.alert("Error", "Enter a valid room count"); return; }
    mutation.mutate({ name: form.name.trim(), totalRooms: parseInt(form.totalRooms) });
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
          <Text style={styles.fieldLabel}>Hotel Name *</Text>
          <TextInput
            style={styles.fieldInput}
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="Grand Palace Hotel"
            placeholderTextColor={C.textSecondary}
          />

          <Text style={styles.fieldLabel}>Total Rooms *</Text>
          <TextInput
            style={styles.fieldInput}
            value={form.totalRooms}
            onChangeText={(v) => setForm((f) => ({ ...f, totalRooms: v }))}
            placeholder="50"
            placeholderTextColor={C.textSecondary}
            keyboardType="numeric"
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

function TopBar() {
  return (
    <View style={styles.topBar}>
      <Pressable onPress={() => router.back()} style={styles.backBtn}>
        <Feather name="arrow-left" size={22} color={C.text} />
      </Pressable>
      <Text style={styles.topTitle}>Edit Hotel</Text>
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
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8, marginTop: 4 },
  fieldInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 14, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, backgroundColor: C.surface, marginBottom: 16 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 18, marginTop: 12 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
