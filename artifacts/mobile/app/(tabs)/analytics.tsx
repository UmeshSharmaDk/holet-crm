import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PieChart, BarChart } from "react-native-chart-kit";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { HotelPicker, useEffectiveHotelId } from "@/components/HotelPicker";
import { api } from "@/lib/api";

const C = Colors.light;
const { width: SCREEN_W } = Dimensions.get("window");
const CHART_W = Math.min(SCREEN_W - 40, 400);
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface OccupancyStats {
  month: number;
  year: number;
  daysInMonth: number;
  totalRooms: number;
  roomNights: number;
  averageOccupiedRooms: number;
  occupancyPercentage: number;
  bookingsCount: number;
  totalRoomsBooked: number;
  totalPersons: number;
}
interface MonthRevenue { month: number; year: number; revenue: number; bookings: number; }
interface AgencyRevenue { agencyId: number | null; agencyName: string; revenue: number; bookings: number; }
interface RevenueStats { monthlyRevenue: MonthRevenue[]; agencyRevenue: AgencyRevenue[]; totalYearlyRevenue: number; }

const PALETTE = [C.accent, C.gold, C.success, C.danger, C.warning, "#8B5CF6", "#EC4899", "#06B6D4"];

export default function AnalyticsScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const effectiveHotelId = useEffectiveHotelId();
  const hotelParam = effectiveHotelId ? `&hotelId=${effectiveHotelId}` : "";

  const occupancyQuery = useQuery<OccupancyStats>({
    queryKey: ["occupancy", month, year, effectiveHotelId],
    queryFn: () => api.get<OccupancyStats>(`/analytics/occupancy?month=${month}&year=${year}${hotelParam}`),
  });

  const revenueQuery = useQuery<RevenueStats>({
    queryKey: ["revenue", year, effectiveHotelId],
    queryFn: () => api.get<RevenueStats>(`/analytics/revenue?year=${year}${hotelParam}`),
  });

  const isLoading = occupancyQuery.isLoading || revenueQuery.isLoading;
  const topInset = Platform.OS === "web" ? 67 : insets.top;

  const occ = occupancyQuery.data;
  const rev = revenueQuery.data;

  const occupiedPct = occ?.occupancyPercentage ?? 0;
  const vacantPct = Math.max(0, 100 - occupiedPct);

  const pieData = [
    { name: "Occupied", population: Math.max(occupiedPct, 0.01), color: C.accent, legendFontColor: C.text, legendFontSize: 13 },
    { name: "Vacant", population: Math.max(vacantPct, 0.01), color: C.border, legendFontColor: C.textSecondary, legendFontSize: 13 },
  ];

  const barData = {
    labels: (rev?.monthlyRevenue ?? []).map((m) => MONTHS_SHORT[m.month - 1]),
    datasets: [{ data: (rev?.monthlyRevenue ?? []).map((m) => m.revenue) }],
  };

  const chartConfig = {
    backgroundColor: C.surface,
    backgroundGradientFrom: C.surface,
    backgroundGradientTo: C.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(59, 130, 246, ${opacity})`,
    labelColor: () => C.textSecondary,
    style: { borderRadius: 16 },
    barPercentage: 0.6,
    propsForDots: { r: "4", strokeWidth: "2", stroke: C.accent },
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topInset + 8, paddingBottom: insets.bottom + 100 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={occupancyQuery.isFetching || revenueQuery.isFetching}
          onRefresh={() => { occupancyQuery.refetch(); revenueQuery.refetch(); }}
          tintColor={C.accent}
        />
      }
    >
      <Text style={styles.title}>Analytics</Text>

      <View style={styles.filterRow}>
        <Pressable onPress={() => setShowMonthPicker(true)} style={styles.monthPill}>
          <Feather name="calendar" size={14} color={C.accent} />
          <Text style={styles.monthText}>{MONTHS_SHORT[month - 1]} {year}</Text>
          <Feather name="chevron-down" size={14} color={C.accent} />
        </Pressable>
        <HotelPicker variant="pill" />
      </View>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <>
          <Section title={`${MONTHS_SHORT[month - 1]} ${year} Occupancy`} icon="percent">
            <View style={styles.statsRow}>
              <MiniStat label="Occupancy" value={`${occupiedPct}%`} unit="avg" color={occupiedPct >= 80 ? C.danger : occupiedPct >= 60 ? C.warning : C.success} />
              <MiniStat label="Avg Rooms / Day" value={String(occ?.averageOccupiedRooms ?? 0)} unit={`of ${occ?.totalRooms ?? 0}`} />
              <MiniStat label="Bookings" value={String(occ?.bookingsCount ?? 0)} unit="this month" />
            </View>
            <View style={styles.statsRow}>
              <MiniStat label="Room-nights" value={String(occ?.roomNights ?? 0)} unit="sold" />
              <MiniStat label="Rooms Booked" value={String(occ?.totalRoomsBooked ?? 0)} unit="total" />
              <MiniStat label="Persons" value={String(occ?.totalPersons ?? 0)} unit="hosted" />
            </View>
            <View style={styles.chartBox}>
              <PieChart
                data={pieData}
                width={CHART_W}
                height={180}
                chartConfig={chartConfig}
                accessor="population"
                backgroundColor="transparent"
                paddingLeft="15"
                absolute={false}
              />
            </View>
          </Section>

          <Section title={`${year} Monthly Revenue`} icon="trending-up">
            <Text style={styles.totalRevenue}>₹{(rev?.totalYearlyRevenue ?? 0).toLocaleString()}</Text>
            <Text style={styles.totalRevLabel}>Total {year} Revenue</Text>
            {barData.labels.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <BarChart
                  data={barData}
                  width={Math.max(CHART_W, barData.labels.length * 60)}
                  height={200}
                  chartConfig={chartConfig}
                  style={{ borderRadius: 12 }}
                  fromZero
                  showValuesOnTopOfBars
                  yAxisLabel="₹"
                  yAxisSuffix=""
                />
              </ScrollView>
            ) : <EmptyChart />}
          </Section>

          <Section title="Revenue by Agency" icon="briefcase">
            {(rev?.agencyRevenue ?? []).length === 0 ? (
              <EmptyChart />
            ) : (
              rev?.agencyRevenue.map((a, i) => (
                <AgencyRow
                  key={a.agencyId ?? "direct"}
                  agency={a}
                  color={PALETTE[i % PALETTE.length]}
                  total={rev.totalYearlyRevenue}
                />
              ))
            )}
          </Section>
        </>
      )}

      <Modal visible={showMonthPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Month</Text>
              <Pressable onPress={() => setShowMonthPicker(false)}>
                <Feather name="x" size={22} color={C.text} />
              </Pressable>
            </View>
            <View style={styles.yearRow}>
              <Pressable onPress={() => setYear((y) => y - 1)}>
                <Feather name="chevron-left" size={24} color={C.text} />
              </Pressable>
              <Text style={styles.yearText}>{year}</Text>
              <Pressable onPress={() => setYear((y) => y + 1)}>
                <Feather name="chevron-right" size={24} color={C.text} />
              </Pressable>
            </View>
            <View style={styles.monthGrid}>
              {MONTHS_SHORT.map((m, i) => (
                <Pressable
                  key={m}
                  style={[styles.monthCell, month === i + 1 && styles.monthCellActive]}
                  onPress={() => { setMonth(i + 1); setShowMonthPicker(false); }}
                >
                  <Text style={[styles.monthCellText, month === i + 1 && styles.monthCellTextActive]}>{m}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Feather name={icon as any} size={18} color={C.accent} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function MiniStat({ label, value, unit, color }: { label: string; value: string; unit: string; color?: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={[styles.miniStatValue, color ? { color } : {}]}>{value}</Text>
      <Text style={styles.miniStatUnit}>{unit}</Text>
      <Text style={styles.miniStatLabel}>{label}</Text>
    </View>
  );
}

function AgencyRow({ agency, color, total }: { agency: AgencyRevenue; color: string; total: number }) {
  const pct = total > 0 ? Math.round((agency.revenue / total) * 100) : 0;
  const aid = agency.agencyId ?? "direct";
  return (
    <Pressable
      style={({ pressed }) => [styles.agencyRow, pressed && { opacity: 0.7 }]}
      onPress={() => router.push(`/agency/${aid}/bookings?name=${encodeURIComponent(agency.agencyName)}` as any)}
    >
      <View style={[styles.agencyDot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={styles.agencyName}>{agency.agencyName}</Text>
          <Text style={styles.agencyRevenue}>₹{agency.revenue.toLocaleString()}</Text>
        </View>
        <View style={styles.agencyBarBg}>
          <View style={[styles.agencyBarFill, { width: `${pct}%`, backgroundColor: color }]} />
        </View>
        <Text style={styles.agencyBookings}>{agency.bookings} bookings • {pct}%</Text>
      </View>
      <Feather name="chevron-right" size={18} color={C.textSecondary} style={{ marginTop: 4 }} />
    </Pressable>
  );
}

function EmptyChart() {
  return (
    <View style={styles.emptyChart}>
      <Feather name="bar-chart" size={28} color={C.border} />
      <Text style={styles.emptyChartText}>No data available</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 20 },
  title: { fontFamily: "Inter_700Bold", fontSize: 28, color: C.text, letterSpacing: -0.5 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8, marginBottom: 16 },
  monthPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.accentLight, alignSelf: "flex-start", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  monthText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.accent },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", minHeight: 300 },
  section: { backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: C.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  miniStat: { flex: 1, backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 12, alignItems: "center" },
  miniStatValue: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.accent },
  miniStatUnit: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textSecondary },
  miniStatLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: C.textSecondary, textAlign: "center", marginTop: 2 },
  chartBox: { alignItems: "center" },
  totalRevenue: { fontFamily: "Inter_700Bold", fontSize: 32, color: C.text, letterSpacing: -1, marginBottom: 2 },
  totalRevLabel: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary, marginBottom: 16 },
  agencyRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 14 },
  agencyDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  agencyName: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: C.text },
  agencyRevenue: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text },
  agencyBarBg: { height: 6, backgroundColor: C.surfaceSecondary, borderRadius: 3, overflow: "hidden", marginBottom: 4 },
  agencyBarFill: { height: "100%", borderRadius: 3 },
  agencyBookings: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary },
  emptyChart: { alignItems: "center", padding: 32, gap: 8 },
  emptyChartText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text },
  yearRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 24, marginBottom: 20 },
  yearText: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  monthCell: { width: "22%", padding: 12, borderRadius: 12, alignItems: "center", backgroundColor: C.surfaceSecondary },
  monthCellActive: { backgroundColor: C.primary },
  monthCellText: { fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  monthCellTextActive: { color: "#fff" },
});
