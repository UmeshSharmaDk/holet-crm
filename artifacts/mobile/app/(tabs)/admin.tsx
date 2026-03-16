import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";

const C = Colors.light;

interface Hotel { id: number; name: string; totalRooms: number; }
interface User { id: number; name: string; email: string; role: string; hotelId: number | null; hotel: Hotel | null; }

type Tab = "hotels" | "users";

export default function AdminScreen() {
  const { user: currentUser } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("hotels");
  const topInset = Platform.OS === "web" ? 67 : insets.top;

  if (currentUser?.role !== "admin") {
    return (
      <View style={[styles.container, { paddingTop: topInset, justifyContent: "center", alignItems: "center" }]}>
        <Feather name="lock" size={40} color={C.border} />
        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text, marginTop: 12 }}>
          Admin Access Only
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <Text style={styles.title}>Admin Panel</Text>
      <View style={styles.tabs}>
        <Pressable style={[styles.tabBtn, tab === "hotels" && styles.tabBtnActive]} onPress={() => setTab("hotels")}>
          <Feather name="home" size={16} color={tab === "hotels" ? "#fff" : C.textSecondary} />
          <Text style={[styles.tabText, tab === "hotels" && styles.tabTextActive]}>Hotels</Text>
        </Pressable>
        <Pressable style={[styles.tabBtn, tab === "users" && styles.tabBtnActive]} onPress={() => setTab("users")}>
          <Feather name="users" size={16} color={tab === "users" ? "#fff" : C.textSecondary} />
          <Text style={[styles.tabText, tab === "users" && styles.tabTextActive]}>Users</Text>
        </Pressable>
      </View>
      {tab === "hotels" ? <HotelsTab /> : <UsersTab />}
    </View>
  );
}

function HotelsTab() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: hotels, isLoading, refetch, isFetching } = useQuery<Hotel[]>({
    queryKey: ["hotels"],
    queryFn: () => api.get<Hotel[]>("/hotels"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/hotels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hotels"] }),
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function confirmDelete(h: Hotel) {
    Alert.alert("Delete Hotel", `Delete "${h.name}"? All bookings will be removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMut.mutate(h.id) },
    ]);
  }

  return (
    <>
      <View style={styles.tabHeader}>
        <Text style={styles.tabSectionTitle}>All Hotels</Text>
        <Pressable style={styles.addBtn} onPress={() => router.push("/hotel/new" as any)}>
          <Feather name="plus" size={20} color="#fff" />
        </Pressable>
      </View>
      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <FlatList
          data={hotels}
          keyExtractor={(h) => String(h.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          refreshing={isFetching}
          onRefresh={refetch}
          ListEmptyComponent={<EmptyState icon="home" text="No hotels yet" />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Feather name="home" size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowSub}>{item.totalRooms} rooms</Text>
              </View>
              <Pressable style={styles.editBtnSm} onPress={() => router.push(`/hotel/edit/${item.id}` as any)}>
                <Feather name="edit-2" size={14} color={C.accent} />
              </Pressable>
              <Pressable style={styles.delBtnSm} onPress={() => confirmDelete(item)}>
                <Feather name="trash-2" size={14} color={C.danger} />
              </Pressable>
            </View>
          )}
        />
      )}
    </>
  );
}

function UsersTab() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { data: users, isLoading, refetch, isFetching } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get<User[]>("/users"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function confirmDelete(u: User) {
    Alert.alert("Delete User", `Delete "${u.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMut.mutate(u.id) },
    ]);
  }

  const ROLE_COLORS: Record<string, string> = { admin: C.danger, owner: C.gold, manager: C.accent };

  return (
    <>
      <View style={styles.tabHeader}>
        <Text style={styles.tabSectionTitle}>All Users</Text>
        <Pressable style={styles.addBtn} onPress={() => router.push("/user/new" as any)}>
          <Feather name="plus" size={20} color="#fff" />
        </Pressable>
      </View>
      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator color={C.accent} /></View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => String(u.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
          refreshing={isFetching}
          onRefresh={refetch}
          ListEmptyComponent={<EmptyState icon="users" text="No users yet" />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: (ROLE_COLORS[item.role] ?? C.accent) + "20" }]}>
                <Feather name="user" size={18} color={ROLE_COLORS[item.role] ?? C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowSub}>{item.email}</Text>
                {item.hotel && <Text style={styles.rowSub2}>{item.hotel.name}</Text>}
              </View>
              <View style={[styles.rolePill, { backgroundColor: (ROLE_COLORS[item.role] ?? C.accent) + "20" }]}>
                <Text style={[styles.roleText, { color: ROLE_COLORS[item.role] ?? C.accent }]}>{item.role}</Text>
              </View>
              <Pressable style={styles.editBtnSm} onPress={() => router.push(`/user/edit/${item.id}` as any)}>
                <Feather name="edit-2" size={14} color={C.accent} />
              </Pressable>
              <Pressable style={styles.delBtnSm} onPress={() => confirmDelete(item)}>
                <Feather name="trash-2" size={14} color={C.danger} />
              </Pressable>
            </View>
          )}
        />
      )}
    </>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={{ alignItems: "center", paddingTop: 60, gap: 8 }}>
      <Feather name={icon as any} size={40} color={C.border} />
      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5, paddingHorizontal: 20, paddingBottom: 14 },
  tabs: { flexDirection: "row", marginHorizontal: 20, marginBottom: 16, gap: 8 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, backgroundColor: C.surfaceSecondary },
  tabBtnActive: { backgroundColor: C.primary },
  tabText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.textSecondary },
  tabTextActive: { color: "#fff" },
  tabHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 8 },
  tabSectionTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text },
  addBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.accent, justifyContent: "center", alignItems: "center" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", paddingTop: 60 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 8, gap: 10, shadowColor: C.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  rowIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center" },
  rowTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  rowSub: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary },
  rowSub2: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.accent, marginTop: 1 },
  editBtnSm: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center" },
  delBtnSm: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.dangerLight, justifyContent: "center", alignItems: "center" },
  rolePill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  roleText: { fontFamily: "Inter_600SemiBold", fontSize: 11, textTransform: "capitalize" },
});
