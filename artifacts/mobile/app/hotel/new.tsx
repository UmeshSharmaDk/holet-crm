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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { api } from "@/lib/api";

const C = Colors.light;

export default function NewHotelScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", totalRooms: "" });

  const mutation = useMutation({
    mutationFn: (data: any) => api.post("/hotels", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hotels"] });
      router.back();
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function submit() {
    if (!form.name.trim()) { Alert.alert("Error", "Hotel name is required"); return; }
    if (!form.totalRooms || isNaN(parseInt(form.totalRooms))) { Alert.alert("Error", "Enter a valid room count"); return; }
    mutation.mutate({ name: form.name.trim(), totalRooms: parseInt(form.totalRooms) });
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={C.text} />
        </Pressable>
        <Text style={styles.topTitle}>New Hotel</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.iconHeader}>
            <View style={styles.iconWrap}>
              <Feather name="home" size={32} color={C.primary} />
            </View>
            <Text style={styles.iconLabel}>Hotel Property</Text>
          </View>

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
              : <><Feather name="plus" size={20} color="#fff" /><Text style={styles.submitText}>Create Hotel</Text></>}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  backBtn: { padding: 4 },
  topTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  iconHeader: { alignItems: "center", paddingVertical: 24 },
  iconWrap: { width: 72, height: 72, borderRadius: 20, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center", marginBottom: 8 },
  iconLabel: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary },
  fieldLabel: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8, marginTop: 4 },
  fieldInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, padding: 14, fontFamily: "Inter_400Regular", fontSize: 15, color: C.text, backgroundColor: C.surface, marginBottom: 16 },
  submitBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 18, marginTop: 12 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
