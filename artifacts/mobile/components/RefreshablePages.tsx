import React, { forwardRef, useRef, useState } from "react";
import {
  Alert, FlatList as NativeFlatList, FlatListProps, RefreshControl,
  ScrollView as NativeScrollView, ScrollViewProps,
} from "react-native";
import Colors from "@/constants/colors";
import { refreshPageData } from "@/lib/query-client";

export function usePageRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  async function onRefresh() {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      await refreshPageData();
    } catch (error) {
      Alert.alert("Refresh failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }
  return { refreshing, onRefresh };
}

export const ScrollView = forwardRef<NativeScrollView, ScrollViewProps>(
  function RefreshableScrollView(props, ref) {
    const refresh = usePageRefresh();
    return (
      <NativeScrollView {...props} ref={ref} alwaysBounceVertical={!props.horizontal}
        refreshControl={props.refreshControl ?? (props.horizontal ? undefined : (
          <RefreshControl {...refresh} tintColor={Colors.light.accent} />
        ))} />
    );
  },
);

export function FlatList<T>(props: FlatListProps<T>) {
  const refresh = usePageRefresh();
  return (
    <NativeFlatList {...props} alwaysBounceVertical
      contentContainerStyle={[{ flexGrow: 1 }, props.contentContainerStyle]}
      refreshing={props.refreshing ?? refresh.refreshing}
      onRefresh={props.onRefresh ?? refresh.onRefresh} />
  );
}
