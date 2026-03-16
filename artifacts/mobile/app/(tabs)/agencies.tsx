import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { api } from "@/lib/api";

const C = Colors.light;

interface Agency {
  id: number;
  name: string;
  contactEmail: string | null;
  contactPhone: string | null;
  hotelId: number;
  createdAt: string;
}

export default function AgenciesScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: agencies, isLoading, refetch, isFetching } = useQuery<Agency[]>({
    queryKey: ["agencies"],
    queryFn: () => api.get<Agency[]>("/agencies"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/agencies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agencies"] }),
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function confirmDelete(a: Agency) {
    Alert.alert("Delete Agency", `Delete "${a.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(a.id) },
    ]);
  }

  const topInset = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Agencies</Text>
        <Pressable style={styles.addBtn} onPress={() => router.push("/agency/new" as any)}>
          <Feather name="plus" size={22} color="#fff" />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <FlatList
          data={agencies}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          refreshing={isFetching}
          onRefresh={refetch}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="users" size={40} color={C.border} />
              <Text style={styles.emptyTitle}>No agencies yet</Text>
              <Text style={styles.emptyText}>Tap + to add a travel agency</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => router.push(`/agency/edit/${item.id}` as any)}
            >
              <View style={styles.cardLeft}>
                <View style={styles.agencyIcon}>
                  <Feather name="briefcase" size={20} color={C.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.agencyName}>{item.name}</Text>
                  {item.contactEmail && (
                    <View style={styles.contactRow}>
                      <Feather name="mail" size={12} color={C.textSecondary} />
                      <Text style={styles.contactText}>{item.contactEmail}</Text>
                    </View>
                  )}
                  {item.contactPhone && (
                    <View style={styles.contactRow}>
                      <Feather name="phone" size={12} color={C.textSecondary} />
                      <Text style={styles.contactText}>{item.contactPhone}</Text>
                    </View>
                  )}
                </View>
              </View>
              <View style={styles.cardActions}>
                <Pressable
                  style={styles.editBtn}
                  onPress={() => router.push(`/agency/edit/${item.id}` as any)}
                >
                  <Feather name="edit-2" size={16} color={C.accent} />
                </Pressable>
                <Pressable style={styles.deleteBtn} onPress={() => confirmDelete(item)}>
                  <Feather name="trash-2" size={16} color={C.danger} />
                </Pressable>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16 },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  addBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accent, justifyContent: "center", alignItems: "center" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 6, elevation: 2 },
  cardLeft: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 12 },
  agencyIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center" },
  agencyName: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text, marginBottom: 4 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  contactText: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  cardActions: { flexDirection: "row", gap: 8 },
  editBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center" },
  deleteBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.dangerLight, justifyContent: "center", alignItems: "center" },
  emptyState: { alignItems: "center", paddingTop: 80, gap: 8 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
});
