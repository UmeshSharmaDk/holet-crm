import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useHotelFilter } from "@/context/HotelFilterContext";
import { api } from "@/lib/api";

const C = Colors.light;

interface Hotel {
  id: number;
  name: string;
  totalRooms: number;
}

interface Props {
  variant?: "banner" | "pill";
  showRooms?: boolean;
}

export function HotelPicker({ variant = "banner", showRooms = true }: Props) {
  const { user } = useAuth();
  const { selectedHotelId, setSelectedHotelId } = useHotelFilter();
  const [open, setOpen] = useState(false);
  const isAdmin = user?.role === "admin";

  const hotelsQuery = useQuery<Hotel[]>({
    queryKey: ["hotels"],
    queryFn: () => api.get<Hotel[]>("/hotels"),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    if (!user?.hotel) return null;
    if (variant === "pill") {
      return (
        <View style={styles.pill}>
          <Feather name="home" size={14} color={C.accent} />
          <Text style={styles.pillText}>{user.hotel.name}</Text>
        </View>
      );
    }
    return (
      <View style={styles.banner}>
        <Feather name="home" size={16} color={C.gold} />
        <Text style={styles.bannerName}>{user.hotel.name}</Text>
        {showRooms && <Text style={styles.bannerRooms}>{user.hotel.totalRooms} Rooms</Text>}
      </View>
    );
  }

  const selectedHotel = selectedHotelId === "all"
    ? null
    : hotelsQuery.data?.find((h) => h.id === selectedHotelId);
  const label = selectedHotelId === "all" ? "All Hotels" : selectedHotel?.name ?? "Select Hotel";
  const rooms = selectedHotelId === "all"
    ? (hotelsQuery.data?.reduce((s, h) => s + h.totalRooms, 0) ?? 0)
    : selectedHotel?.totalRooms ?? 0;

  return (
    <>
      {variant === "pill" ? (
        <Pressable onPress={() => setOpen(true)} style={styles.pill}>
          <Feather name="home" size={14} color={C.accent} />
          <Text style={styles.pillText}>{label}</Text>
          <Feather name="chevron-down" size={14} color={C.accent} />
        </Pressable>
      ) : (
        <Pressable style={styles.banner} onPress={() => setOpen(true)}>
          <Feather name="home" size={16} color={C.gold} />
          <Text style={styles.bannerName}>{label}</Text>
          {showRooms && <Text style={styles.bannerRooms}>{rooms} Rooms</Text>}
          <Feather name="chevron-down" size={18} color="rgba(255,255,255,0.85)" />
        </Pressable>
      )}

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select Hotel</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={10}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              <Pressable
                style={[styles.option, selectedHotelId === "all" && styles.optionActive]}
                onPress={() => { setSelectedHotelId("all"); setOpen(false); }}
              >
                <Feather name="grid" size={18} color={selectedHotelId === "all" ? "#fff" : C.text} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.optionName, selectedHotelId === "all" && { color: "#fff" }]}>All Hotels</Text>
                  <Text style={[styles.optionMeta, selectedHotelId === "all" && { color: "rgba(255,255,255,0.8)" }]}>
                    Aggregated across {hotelsQuery.data?.length ?? 0} hotels
                  </Text>
                </View>
                {selectedHotelId === "all" && <Feather name="check" size={20} color="#fff" />}
              </Pressable>
              {(hotelsQuery.data ?? []).map((h) => {
                const active = selectedHotelId === h.id;
                return (
                  <Pressable
                    key={h.id}
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => { setSelectedHotelId(h.id); setOpen(false); }}
                  >
                    <Feather name="home" size={18} color={active ? "#fff" : C.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionName, active && { color: "#fff" }]}>{h.name}</Text>
                      <Text style={[styles.optionMeta, active && { color: "rgba(255,255,255,0.8)" }]}>{h.totalRooms} rooms</Text>
                    </View>
                    {active && <Feather name="check" size={20} color="#fff" />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function useEffectiveHotelId(): number | null {
  const { user } = useAuth();
  const { selectedHotelId } = useHotelFilter();
  if (user?.role === "admin") {
    return selectedHotelId === "all" ? null : selectedHotelId;
  }
  return user?.hotelId ?? null;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  bannerName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: "#fff", flex: 1 },
  bannerRooms: { fontFamily: "Inter_400Regular", fontSize: 12, color: "rgba(255,255,255,0.7)" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.accentLight,
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.accent, maxWidth: 180 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  option: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, backgroundColor: C.surfaceSecondary, marginBottom: 8 },
  optionActive: { backgroundColor: C.primary },
  optionName: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: C.text },
  optionMeta: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
});
