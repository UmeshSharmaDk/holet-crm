import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
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
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Please enter email and password");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e?.message ?? "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoArea}>
          <View style={styles.logoIcon}>
            <Feather name="home" size={36} color={C.gold} />
          </View>
          <Text style={styles.appName}>Hotel CRM</Text>
          <Text style={styles.tagline}>Property Management System</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Welcome back</Text>
          <Text style={styles.subheading}>Sign in to your account</Text>

          {error ? (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={15} color={C.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputWrap}>
              <Feather name="mail" size={18} color={C.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="you@hotel.com"
                placeholderTextColor={C.textSecondary}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrap}>
              <Feather name="lock" size={18} color={C.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { paddingRight: 48 }]}
                placeholder="••••••••"
                placeholderTextColor={C.textSecondary}
                secureTextEntry={!showPassword}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={handleLogin}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={C.textSecondary} />
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.loginBtn, pressed && styles.loginBtnPressed, loading && styles.loginBtnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.loginBtnText}>Sign In</Text>
            )}
          </Pressable>

          <View style={styles.demoHint}>
            <Text style={styles.demoTitle}>Demo Credentials</Text>
            <Text style={styles.demoLine}>admin@hotel.com / admin123</Text>
            <Text style={styles.demoLine}>owner@hotel.com / owner123</Text>
            <Text style={styles.demoLine}>manager@hotel.com / manager123</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.primary },
  scroll: { paddingHorizontal: 24, flexGrow: 1, justifyContent: "center" },
  logoArea: { alignItems: "center", marginBottom: 36 },
  logoIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: C.primary,
    borderWidth: 2,
    borderColor: C.gold,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  appName: { fontFamily: "Inter_700Bold", fontSize: 32, color: "#fff", letterSpacing: -0.5 },
  tagline: { fontFamily: "Inter_400Regular", fontSize: 14, color: "rgba(255,255,255,0.6)", marginTop: 4 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  heading: { fontFamily: "Inter_700Bold", fontSize: 26, color: C.text, letterSpacing: -0.4 },
  subheading: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, marginTop: 4, marginBottom: 20 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.dangerLight,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.danger, flex: 1 },
  inputGroup: { marginBottom: 16 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.surfaceSecondary,
  },
  inputIcon: { marginLeft: 14 },
  input: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 14,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: C.text,
  },
  eyeBtn: { padding: 12 },
  loginBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 20,
  },
  loginBtnPressed: { opacity: 0.85 },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { fontFamily: "Inter_700Bold", fontSize: 16, color: "#fff" },
  demoHint: {
    backgroundColor: C.accentLight,
    borderRadius: 10,
    padding: 12,
    gap: 2,
  },
  demoTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.accent, marginBottom: 4 },
  demoLine: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary },
});
