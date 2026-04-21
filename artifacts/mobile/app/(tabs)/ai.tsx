import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import React, { useEffect, useRef, useState } from "react";
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
import AsyncStorage from "@react-native-async-storage/async-storage";

const C = Colors.light;
const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  id: string;
}

const STARTERS_EN = [
  "How many rooms are occupied today?",
  "Show this month's revenue",
  "Create booking for John Doe, Room 101, check-in tomorrow, 3 nights, ₹2500/night",
  "Today's check-ins",
];
const STARTERS_HI = [
  "आज कितने कमरे भरे हुए हैं?",
  "इस महीने का राजस्व दिखाओ",
];

export default function AIScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const webRecorderRef = useRef<MediaRecorder | null>(null);
  const webChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (soundRef.current) soundRef.current.unloadAsync();
    };
  }, []);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages, loading]);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await AsyncStorage.getItem("auth_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const userMsg: ChatMsg = { role: "user", content: trimmed, id: String(Date.now()) };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "AI error");
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, id: String(Date.now() + 1) }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${e?.message ?? "Failed"}`, id: String(Date.now() + 1) }]);
    } finally {
      setLoading(false);
    }
  }

  async function startRecording() {
    try {
      if (Platform.OS === "web") {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        webChunksRef.current = [];
        mr.ondataavailable = (e) => { if (e.data.size > 0) webChunksRef.current.push(e.data); };
        mr.start();
        webRecorderRef.current = mr;
        setIsRecording(true);
        return;
      }
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      setRecording(rec);
      setIsRecording(true);
    } catch (e: any) {
      console.error(e);
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ Microphone error: ${e?.message}`, id: String(Date.now()) }]);
    }
  }

  async function stopRecording() {
    setIsRecording(false);
    setLoading(true);
    try {
      let formData = new FormData();
      if (Platform.OS === "web") {
        const mr = webRecorderRef.current;
        if (!mr) return;
        await new Promise<void>((resolve) => {
          mr.onstop = () => resolve();
          mr.stop();
          mr.stream.getTracks().forEach((t) => t.stop());
        });
        const blob = new Blob(webChunksRef.current, { type: "audio/webm" });
        formData.append("audio", blob, "audio.webm");
      } else {
        if (!recording) return;
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        if (!uri) return;
        const ext = uri.split(".").pop() ?? "m4a";
        formData.append("audio", { uri, name: `audio.${ext}`, type: `audio/${ext === "m4a" ? "mp4" : ext}` } as any);
      }
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/ai/stt`, { method: "POST", headers, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "STT failed");
      if (data.text?.trim()) {
        await send(data.text);
        return;
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: `⚠️ ${e?.message ?? "Failed"}`, id: String(Date.now()) }]);
    } finally {
      setLoading(false);
    }
  }

  async function speak(msg: ChatMsg) {
    try {
      if (speakingId === msg.id) {
        if (soundRef.current) {
          await soundRef.current.stopAsync();
          await soundRef.current.unloadAsync();
          soundRef.current = null;
        }
        setSpeakingId(null);
        return;
      }
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      setSpeakingId(msg.id);
      const headers = await authHeaders();
      const res = await fetch(`${BASE_URL}/api/ai/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ text: msg.content }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = await blobToDataUrl(blob);
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status: any) => {
        if (status?.didJustFinish) {
          setSpeakingId(null);
          sound.unloadAsync();
          if (soundRef.current === sound) soundRef.current = null;
        }
      });
    } catch (e: any) {
      console.error(e);
      setSpeakingId(null);
    }
  }

  function clearChat() {
    setMessages([]);
  }

  const showStarters = messages.length === 0 && !loading;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 12) }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.aiAvatar}>
            <Feather name="cpu" size={20} color="#fff" />
          </View>
          <View>
            <Text style={styles.title}>AI Assistant</Text>
            <Text style={styles.subtitle}>Hindi & English • Hotel CRM</Text>
          </View>
        </View>
        {messages.length > 0 && (
          <Pressable onPress={clearChat} style={styles.clearBtn}>
            <Feather name="trash-2" size={16} color={C.textSecondary} />
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={styles.messagesContent}
        showsVerticalScrollIndicator={false}
      >
        {showStarters && (
          <View style={styles.welcome}>
            <View style={styles.welcomeAvatar}>
              <Feather name="message-circle" size={32} color={C.accent} />
            </View>
            <Text style={styles.welcomeTitle}>Hello {user?.name?.split(" ")[0] || ""}!</Text>
            <Text style={styles.welcomeText}>
              Ask me anything about your hotel — check occupancy, view bookings, see revenue, or create new bookings. I understand Hindi too.
            </Text>
            <Text style={styles.starterLabel}>Try:</Text>
            {[...STARTERS_EN, ...STARTERS_HI].map((s) => (
              <Pressable key={s} style={styles.starterChip} onPress={() => send(s)}>
                <Text style={styles.starterText}>{s}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {messages.map((m) => (
          <View key={m.id} style={[styles.bubbleRow, m.role === "user" ? styles.bubbleRowUser : styles.bubbleRowAi]}>
            <View style={[styles.bubble, m.role === "user" ? styles.bubbleUser : styles.bubbleAi]}>
              <Text style={[styles.bubbleText, m.role === "user" ? { color: "#fff" } : { color: C.text }]}>
                {m.content}
              </Text>
              {m.role === "assistant" && (
                <Pressable style={styles.speakBtn} onPress={() => speak(m)}>
                  <Feather
                    name={speakingId === m.id ? "stop-circle" : "volume-2"}
                    size={14}
                    color={C.accent}
                  />
                  <Text style={styles.speakText}>{speakingId === m.id ? "Stop" : "Listen"}</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}

        {loading && (
          <View style={[styles.bubbleRow, styles.bubbleRowAi]}>
            <View style={[styles.bubble, styles.bubbleAi, styles.thinkingBubble]}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={styles.thinkingText}>Thinking…</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={[styles.inputBar, { paddingBottom: insets.bottom + (Platform.OS === "web" ? 70 : 80) }]}>
        <Pressable
          style={[styles.micBtn, isRecording && styles.micBtnActive]}
          onPress={isRecording ? stopRecording : startRecording}
          disabled={loading && !isRecording}
        >
          <Feather name={isRecording ? "stop-circle" : "mic"} size={20} color={isRecording ? "#fff" : C.accent} />
        </Pressable>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={isRecording ? "Listening…" : "Ask anything (English / हिंदी)"}
          placeholderTextColor={C.textSecondary}
          multiline
          maxLength={1000}
          editable={!isRecording}
          onSubmitEditing={() => send(input)}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.4 }]}
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
        >
          <Feather name="send" size={18} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 8 },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  aiAvatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.accent, justifyContent: "center", alignItems: "center" },
  title: { fontFamily: "Inter_700Bold", fontSize: 20, color: C.text, letterSpacing: -0.3 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 11, color: C.textSecondary, marginTop: 2 },
  clearBtn: { padding: 8, borderRadius: 8, backgroundColor: C.surfaceSecondary },
  messages: { flex: 1 },
  messagesContent: { paddingHorizontal: 16, paddingVertical: 16, gap: 10 },
  welcome: { alignItems: "center", padding: 16, gap: 10 },
  welcomeAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center", marginBottom: 8 },
  welcomeTitle: { fontFamily: "Inter_700Bold", fontSize: 22, color: C.text, letterSpacing: -0.5 },
  welcomeText: { fontFamily: "Inter_400Regular", fontSize: 14, color: C.textSecondary, textAlign: "center", lineHeight: 20, paddingHorizontal: 20 },
  starterLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.textSecondary, marginTop: 12, alignSelf: "flex-start", paddingLeft: 4 },
  starterChip: { backgroundColor: C.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, alignSelf: "stretch", borderWidth: 1, borderColor: C.border },
  starterText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.text },
  bubbleRow: { flexDirection: "row", marginBottom: 4 },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubbleRowAi: { justifyContent: "flex-start" },
  bubble: { maxWidth: "85%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: C.accent, borderBottomRightRadius: 4 },
  bubbleAi: { backgroundColor: C.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  bubbleText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  speakBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
  speakText: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.accent },
  thinkingBubble: { flexDirection: "row", alignItems: "center", gap: 8 },
  thinkingText: { fontFamily: "Inter_400Regular", fontSize: 13, color: C.textSecondary },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 8, paddingHorizontal: 12, paddingTop: 8, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border },
  micBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center" },
  micBtnActive: { backgroundColor: C.danger },
  input: { flex: 1, minHeight: 42, maxHeight: 120, backgroundColor: C.surfaceSecondary, borderRadius: 20, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.accent, justifyContent: "center", alignItems: "center" },
});
