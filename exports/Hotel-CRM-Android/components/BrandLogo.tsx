import React from "react";
import { Image, StyleSheet, View, useWindowDimensions } from "react-native";

export function BrandLogo({ compact = false }: { compact?: boolean }) {
  const { width } = useWindowDimensions();
  const size = compact ? 96 : Math.min(260, Math.max(160, width - 80));
  return (
    <View style={[styles.container, { width: size, height: size }, compact && styles.compactContainer]}>
      <Image
        source={require("@/assets/images/brand-logo.png")}
        style={styles.image}
        resizeMode="contain"
        accessibilityLabel="StayPilot logo"
        testID="staypilot-logo"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#ffffff", borderRadius: 20 },
  compactContainer: { borderRadius: 10 },
  image: { width: "100%", height: "100%" },
});
