import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
        <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 16, color: C.text, marginTop: 12 }}>Admin Access Only</Text>
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
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Hotel | null>(null);
  const [form, setForm] = useState({ name: "", totalRooms: "" });

  const { data: hotels, isLoading, refetch, isFetching } = useQuery<Hotel[]>({
    queryKey: ["hotels"],
    queryFn: () => api.get<Hotel[]>("/hotels"),
  });

  const createMut = useMutation({
    mutationFn: (d: any) => api.post("/hotels", d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hotels"] }); close(); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const updateMut = useMutation({
    mutationFn: (d: any) => api.put(`/hotels/${editing?.id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hotels"] }); close(); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/hotels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hotels"] }),
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function openNew() { setEditing(null); setForm({ name: "", totalRooms: "" }); setShowForm(true); }
  function openEdit(h: Hotel) { setEditing(h); setForm({ name: h.name, totalRooms: String(h.totalRooms) }); setShowForm(true); }
  function close() { setShowForm(false); setEditing(null); }
  function submit() {
    if (!form.name || !form.totalRooms) { Alert.alert("Error", "All fields required"); return; }
    const d = { name: form.name.trim(), totalRooms: parseInt(form.totalRooms) };
    editing ? updateMut.mutate(d) : createMut.mutate(d);
  }
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
        <Pressable style={styles.addBtn} onPress={openNew}><Feather name="plus" size={20} color="#fff" /></Pressable>
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
              <View style={styles.rowIcon}><Feather name="home" size={18} color={C.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowSub}>{item.totalRooms} rooms</Text>
              </View>
              <Pressable style={styles.editBtnSm} onPress={() => openEdit(item)}><Feather name="edit-2" size={14} color={C.accent} /></Pressable>
              <Pressable style={styles.delBtnSm} onPress={() => confirmDelete(item)}><Feather name="trash-2" size={14} color={C.danger} /></Pressable>
            </View>
          )}
        />
      )}
      <FormModal
        visible={showForm}
        onClose={close}
        title={editing ? "Edit Hotel" : "New Hotel"}
        onSubmit={submit}
        isPending={createMut.isPending || updateMut.isPending}
      >
        <Field label="Hotel Name *" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Grand Palace Hotel" />
        <Field label="Total Rooms *" value={form.totalRooms} onChangeText={(v) => setForm((f) => ({ ...f, totalRooms: v }))} placeholder="50" keyboardType="numeric" />
      </FormModal>
    </>
  );
}

function UsersTab() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "manager", hotelId: "" });

  const { data: users, isLoading, refetch, isFetching } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: () => api.get<User[]>("/users"),
  });

  const { data: hotels } = useQuery<Hotel[]>({
    queryKey: ["hotels"],
    queryFn: () => api.get<Hotel[]>("/hotels"),
  });

  const createMut = useMutation({
    mutationFn: (d: any) => api.post("/users", d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); close(); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const updateMut = useMutation({
    mutationFn: (d: any) => api.put(`/users/${editing?.id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); close(); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  function openNew() { setEditing(null); setForm({ name: "", email: "", password: "", role: "manager", hotelId: "" }); setShowForm(true); }
  function openEdit(u: User) { setEditing(u); setForm({ name: u.name, email: u.email, password: "", role: u.role, hotelId: u.hotelId ? String(u.hotelId) : "" }); setShowForm(true); }
  function close() { setShowForm(false); setEditing(null); }

  function submit() {
    if (!form.email || !form.name) { Alert.alert("Error", "Name and email required"); return; }
    if (!editing && !form.password) { Alert.alert("Error", "Password required"); return; }
    const d: any = { name: form.name.trim(), email: form.email.trim(), role: form.role, hotelId: form.hotelId ? parseInt(form.hotelId) : null };
    if (form.password) d.password = form.password;
    editing ? updateMut.mutate(d) : createMut.mutate({ ...d, password: form.password });
  }

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
        <Pressable style={styles.addBtn} onPress={openNew}><Feather name="plus" size={20} color="#fff" /></Pressable>
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
              <Pressable style={styles.editBtnSm} onPress={() => openEdit(item)}><Feather name="edit-2" size={14} color={C.accent} /></Pressable>
              <Pressable style={styles.delBtnSm} onPress={() => confirmDelete(item)}><Feather name="trash-2" size={14} color={C.danger} /></Pressable>
            </View>
          )}
        />
      )}
      <FormModal
        visible={showForm}
        onClose={close}
        title={editing ? "Edit User" : "New User"}
        onSubmit={submit}
        isPending={createMut.isPending || updateMut.isPending}
      >
        <Field label="Full Name *" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Jane Doe" />
        <Field label="Email *" value={form.email} onChangeText={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="jane@hotel.com" keyboardType="email-address" />
        <Field label={editing ? "New Password (leave blank to keep)" : "Password *"} value={form.password} onChangeText={(v) => setForm((f) => ({ ...f, password: v }))} placeholder="••••••••" secureTextEntry />
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8 }}>Role *</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {["admin", "owner", "manager"].map((r) => (
              <Pressable key={r} style={[styles.rolePicker, form.role === r && styles.rolePickerActive]} onPress={() => setForm((f) => ({ ...f, role: r }))}>
                <Text style={[styles.rolePickerText, form.role === r && styles.rolePickerTextActive]}>{r}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8 }}>Hotel</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Pressable style={[styles.rolePicker, !form.hotelId && styles.rolePickerActive]} onPress={() => setForm((f) => ({ ...f, hotelId: "" }))}>
              <Text style={[styles.rolePickerText, !form.hotelId && styles.rolePickerTextActive]}>None</Text>
            </Pressable>
            {(hotels ?? []).map((h) => (
              <Pressable key={h.id} style={[styles.rolePicker, form.hotelId === String(h.id) && styles.rolePickerActive]} onPress={() => setForm((f) => ({ ...f, hotelId: String(h.id) }))}>
                <Text style={[styles.rolePickerText, form.hotelId === String(h.id) && styles.rolePickerTextActive]}>{h.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </FormModal>
    </>
  );
}

function FormModal({ visible, onClose, title, onSubmit, isPending, children }: {
  visible: boolean; onClose: () => void; title: string; onSubmit: () => void; isPending: boolean; children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={[styles.modalContent, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{title}</Text>
            <Pressable onPress={onClose}><Feather name="x" size={22} color={C.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {children}
            <Pressable style={[styles.submitBtn, isPending && { opacity: 0.6 }]} onPress={onSubmit} disabled={isPending}>
              {isPending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.submitText}>Save</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({ label, value, onChangeText, placeholder, keyboardType, secureTextEntry }: any) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 6 }}>{label}</Text>
      <TextInput
        style={{ borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, backgroundColor: C.surfaceSecondary }}
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
  rolePicker: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.surfaceSecondary },
  rolePickerActive: { backgroundColor: C.primary },
  rolePickerText: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.text, textTransform: "capitalize" },
  rolePickerTextActive: { color: "#fff" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "90%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  submitBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  submitText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
});
