import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, GestureResponderEvent, Keyboard,
  PanResponder, Platform, StyleSheet, Text, View,
} from "react-native";
import { router, useGlobalSearchParams, usePathname, useSegments } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { refreshPageData } from "@/lib/query-client";

const tabs = ["index", "bookings", "agencies", "analytics", "ai", "admin"];
type TabNavigator = (name: string) => void;
const TabSwipeNavigationContext = createContext<(navigate: TabNavigator) => void>(() => {});
export const useTabSwipeNavigation = () => useContext(TabSwipeNavigationContext);

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
  const tabNavigator = useRef<TabNavigator | null>(null);
  const registerTabNavigator = useCallback((navigate: TabNavigator) => {
    tabNavigator.current = navigate;
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const refreshBusy = useRef(false);
  const webPull = useRef<{ x: number; y: number; eligible: boolean } | null>(null);
  const gestureBlocked = useRef(false);
  const history = useRef<{ paths: string[]; index: number }>({ paths: [], index: -1 });
  const pendingHistory = useRef<number | null>(null);
  const forward = useRef<string | null>(null);
  const lastNavigation = useRef(0);
  const navigatedThisTouch = useRef(false);
  const availableTabs = user?.role === "admin" ? tabs : tabs.slice(0, -1);
  const activeTab = segments[0] === "(tabs)" ? pathname.split("/").filter(Boolean)[0] || "index" : null;
  const tabIndex = activeTab ? availableTabs.indexOf(activeTab) : -1;
  const search = Object.entries(params)
    .filter(([key]) => !segments.some((segment) => segment === `[${key}]`))
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value])
      .filter((item) => item !== undefined)
      .map((item) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`))
    .join("&");
  const href = pathname + (search ? `?${search}` : "");
  // Keep a single responder for the lifetime of the layer. A navigation can
  // render while its touch is ending; replacing responders then can use a
  // previous route or process the same swipe more than once.
  const navigation = useRef({ user, tabIndex, availableTabs, href });
  navigation.current = { user, tabIndex, availableTabs, href };

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

  useEffect(() => {
    if (Platform.OS !== "web") return;
    // DOM capture is reliable even when a child Pressable/ScrollView owns the
    // RN responder. Do not run both DOM and PanResponder navigation on web.
    function startTouch(event: TouchEvent) {
      const touch = event.touches[0];
      const layer = document.querySelector('[data-testid="app-gesture-layer"]');
      if (!touch || event.touches.length !== 1 || !layer?.contains(event.target as Node)) {
        webPull.current = null;
        return;
      }
      const target = webGestureTarget(event.target);
      // Some RN wrappers are the touch target even inside an input's box.
      const overInput = Array.from(document.querySelectorAll("input, textarea, [contenteditable=true]"))
        .some((input) => {
          const rect = input.getBoundingClientRect();
          return touch.clientX >= rect.left && touch.clientX <= rect.right &&
            touch.clientY >= rect.top && touch.clientY <= rect.bottom;
        });
      gestureBlocked.current = target.editable || target.horizontal || overInput;
      navigatedThisTouch.current = false;
      webPull.current = {
        x: touch.pageX, y: touch.pageY,
        eligible: target.atTop && !gestureBlocked.current,
      };
    }
    function moveTouch(event: TouchEvent) {
      const start = webPull.current;
      const touch = event.touches[0];
      if (!start || !touch || event.touches.length !== 1 ||
        !navigation.current.user || gestureBlocked.current) return;
      const dx = touch.pageX - start.x;
      const dy = touch.pageY - start.y;
      if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        event.preventDefault();
      }
    }
    function endTouch(event: TouchEvent) {
      const start = webPull.current;
      const touch = event.changedTouches[0];
      webPull.current = null;
      if (!start || !touch || gestureBlocked.current) return;
      const dx = touch.pageX - start.x;
      const dy = touch.pageY - start.y;
      if (Math.abs(dx) >= 75 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        event.preventDefault();
        navigateSwipe(dx);
      } else if (start.eligible && dy >= 85 && dy > Math.abs(dx) * 1.6 &&
        webGestureTarget(event.target).atTop) {
        event.preventDefault();
        void refresh();
      }
    }
    function cancelTouch() { webPull.current = null; }
    const options = { passive: false, capture: true };
    document.addEventListener("touchstart", startTouch, options);
    document.addEventListener("touchmove", moveTouch, options);
    document.addEventListener("touchend", endTouch, options);
    document.addEventListener("touchcancel", cancelTouch, options);
    return () => {
      document.removeEventListener("touchstart", startTouch, true);
      document.removeEventListener("touchmove", moveTouch, true);
      document.removeEventListener("touchend", endTouch, true);
      document.removeEventListener("touchcancel", cancelTouch, true);
    };
  }, []);

  function navigateSwipe(dx: number) {
    if (!navigation.current.user || navigatedThisTouch.current || Date.now() - lastNavigation.current < 350) return;
    navigatedThisTouch.current = true;
    lastNavigation.current = Date.now();
    const { tabIndex, availableTabs, href } = navigation.current;
    if (dx < 0 && forward.current) {
      const destination = forward.current;
      forward.current = null;
      pendingHistory.current = history.current.index + 1;
      router.push(destination as never);
    } else if (tabIndex >= 0) {
      const next = availableTabs[tabIndex + (dx < 0 ? 1 : -1)];
      // Use the navigation object supplied by the mounted tab navigator,
      // rather than deriving a nested state key from the root router.
      if (next) tabNavigator.current?.(next);
    } else if (dx > 0 && router.canGoBack()) {
      forward.current = href;
      router.back();
    }
  }

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_, gesture) =>
      Platform.OS !== "web" && !!navigation.current.user && !gestureBlocked.current && !Keyboard.isVisible() &&
      gesture.numberActiveTouches === 1 && Math.abs(gesture.dx) > 25 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) < 75 || Math.abs(gesture.dx) < Math.abs(gesture.dy) * 1.6) return;
      navigateSwipe(gesture.dx);
    },
  }), []);

  async function refresh() {
    if (refreshBusy.current || !navigation.current.user) return;
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
    if (Platform.OS === "web") return;
    navigatedThisTouch.current = false;
    const target = webGestureTarget(event.target);
    gestureBlocked.current = target.editable || target.horizontal;
  }

  return (
    <TabSwipeNavigationContext.Provider value={registerTabNavigator}>
    <View style={styles.container} {...responder.panHandlers}
      onTouchStart={touchStart}
      onTouchCancel={Platform.OS === "web" ? undefined : () => { webPull.current = null; }}
      testID="app-gesture-layer">
      {children}
      {refreshing && (
        <View style={styles.refresh} pointerEvents="none" accessibilityLiveRegion="polite">
          <ActivityIndicator color={Colors.light.accent} size="small" />
          <Text style={styles.refreshText}>Refreshing…</Text>
        </View>
      )}
    </View>
    </TabSwipeNavigationContext.Provider>
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
