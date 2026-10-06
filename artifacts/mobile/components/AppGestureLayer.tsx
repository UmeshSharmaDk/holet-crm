import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, GestureResponderEvent, Keyboard,
  PanResponder, Platform, StyleSheet, Text, View,
} from "react-native";
import { router, useGlobalSearchParams, usePathname, useSegments } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { refreshPageData } from "@/lib/query-client";

const tabs = ["index", "bookings", "agencies", "analytics", "ai", "admin"];

// On the web, RefreshControl is not implemented. Observe a pull without taking
// the vertical responder from the page's ScrollView. Only pulls at its top count.
function webGestureTarget(target: unknown) {
  if (Platform.OS !== "web" || !(target instanceof Element)) {
    return { editable: false, horizontal: false, atTop: true };
  }
  let horizontal = false;
  let atTop = true;
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (node.matches("input, textarea, [contenteditable=true]")) {
      return { editable: true, horizontal: false, atTop: false };
    }
    const element = node as HTMLElement;
    const css = window.getComputedStyle(element);
    if (/(auto|scroll)/.test(css.overflowX) && element.scrollWidth > element.clientWidth + 1) {
      horizontal = true;
    }
    if (/(auto|scroll)/.test(css.overflowY) && element.scrollTop > 1) atTop = false;
  }
  return { editable: false, horizontal, atTop };
}

export function AppGestureLayer({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const segments = useSegments() as string[];
  const params = useGlobalSearchParams();
  const [refreshing, setRefreshing] = useState(false);
  const refreshBusy = useRef(false);
  const webPull = useRef<{ x: number; y: number; eligible: boolean } | null>(null);
  const gestureBlocked = useRef(false);
  const history = useRef<{ paths: string[]; index: number }>({ paths: [], index: -1 });
  const pendingHistory = useRef<number | null>(null);
  const forward = useRef<string | null>(null);
  const availableTabs = user?.role === "admin" ? tabs : tabs.slice(0, -1);
  const activeTab = segments[0] === "(tabs)" ? segments[1] || "index" : null;
  const tabIndex = activeTab ? availableTabs.indexOf(activeTab) : -1;
  const search = Object.entries(params)
    .filter(([key]) => !segments.some((segment) => segment === `[${key}]`))
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value])
      .filter((item) => item !== undefined)
      .map((item) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`))
    .join("&");
  const href = pathname + (search ? `?${search}` : "");

  useEffect(() => {
    if (!user) {
      history.current = { paths: [], index: -1 };
      forward.current = null;
      return;
    }
    const current = history.current;
    if (pendingHistory.current !== null) {
      current.index = pendingHistory.current;
      pendingHistory.current = null;
    } else if (current.paths[current.index] !== href) {
      if (current.index > 0 && current.paths[current.index - 1] === href) {
        current.index -= 1;
      } else {
        current.paths = [...current.paths.slice(0, current.index + 1), href];
        current.index = current.paths.length - 1;
        forward.current = null;
      }
    }
  }, [href, user?.id]);

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      !!user && !gestureBlocked.current && !Keyboard.isVisible() &&
      gesture.numberActiveTouches === 1 && Math.abs(gesture.dx) > 25 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) < 75 || Math.abs(gesture.dx) < Math.abs(gesture.dy) * 1.6) return;
      if (gesture.dx < 0 && forward.current) {
        const destination = forward.current;
        forward.current = null;
        pendingHistory.current = history.current.index + 1;
        router.push(destination as never);
      } else if (tabIndex >= 0) {
        const next = availableTabs[tabIndex + (gesture.dx < 0 ? 1 : -1)];
        if (next) router.navigate((next === "index" ? "/(tabs)" : `/(tabs)/${next}`) as never);
      } else if (gesture.dx > 0 && router.canGoBack()) {
        // Preserve a forward destination even when the native stack pops it.
        forward.current = href;
        router.back();
      }
    },
  }), [user?.id, tabIndex, user?.role, href]);

  async function refresh() {
    if (refreshBusy.current || !user) return;
    refreshBusy.current = true;
    setRefreshing(true);
    try {
      await refreshPageData();
    } catch (error) {
      Alert.alert("Refresh failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      refreshBusy.current = false;
      setRefreshing(false);
    }
  }

  function touchStart(event: GestureResponderEvent) {
    const target = webGestureTarget(event.target);
    gestureBlocked.current = target.editable || target.horizontal;
    webPull.current = {
      x: event.nativeEvent.pageX, y: event.nativeEvent.pageY,
      eligible: Platform.OS === "web" && target.atTop && !target.editable && !target.horizontal,
    };
  }

  function touchEnd(event: GestureResponderEvent) {
    const start = webPull.current;
    webPull.current = null;
    if (!start?.eligible || refreshBusy.current) return;
    const dx = event.nativeEvent.pageX - start.x;
    const dy = event.nativeEvent.pageY - start.y;
    if (dy >= 85 && dy > Math.abs(dx) * 1.6 && webGestureTarget(event.target).atTop) {
      void refresh();
    }
  }

  return (
    <View style={styles.container} {...responder.panHandlers}
      onTouchStart={touchStart} onTouchEnd={touchEnd}
      onTouchCancel={() => { webPull.current = null; }}
      testID="app-gesture-layer">
      {children}
      {refreshing && (
        <View style={styles.refresh} pointerEvents="none" accessibilityLiveRegion="polite">
          <ActivityIndicator color={Colors.light.accent} size="small" />
          <Text style={styles.refreshText}>Refreshing…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  refresh: {
    position: "absolute", top: 64, alignSelf: "center", flexDirection: "row",
    gap: 8, padding: 12, borderRadius: 24, backgroundColor: Colors.light.surface,
  },
  refreshText: { color: Colors.light.text, fontSize: 13 },
});
