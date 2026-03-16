import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Colors from "@/constants/colors";

const C = Colors.light;

interface Props {
  label: string;
  value: string;
  onChange: (dateStr: string) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  flex?: boolean;
}

function toDate(str: string): Date {
  if (!str) return new Date();
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? new Date() : dt;
}

function toStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplay(str: string): string {
  if (!str) return "Select date";
  const d = toDate(str);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function DatePickerField({ label, value, onChange, minimumDate, maximumDate, flex }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(toDate(value));

  function handleOpen() {
    setTempDate(toDate(value));
    setShowPicker(true);
  }

  function handleChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === "android") {
      setShowPicker(false);
      if (event.type === "set" && selected) onChange(toStr(selected));
    } else {
      if (selected) setTempDate(selected);
    }
  }

  function handleDone() {
    setShowPicker(false);
    onChange(toStr(tempDate));
  }

  function handleCancel() {
    setShowPicker(false);
  }

  if (Platform.OS === "web") {
    return (
      <View style={[styles.field, flex && { flex: 1 }]}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.webInputWrap}>
          <Feather name="calendar" size={16} color={C.textSecondary} style={styles.calIcon} />
          <TextInput
            style={styles.webInput}
            value={value}
            onChangeText={onChange}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={C.textSecondary}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.field, flex && { flex: 1 }]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.75 }]}
        onPress={handleOpen}
      >
        <Feather name="calendar" size={16} color={C.accent} />
        <Text style={styles.btnText}>{formatDisplay(value)}</Text>
        <Feather name="chevron-down" size={14} color={C.textSecondary} />
      </Pressable>

      {Platform.OS === "ios" && (
        <Modal visible={showPicker} transparent animationType="slide">
          <Pressable style={styles.overlay} onPress={handleCancel} />
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Pressable onPress={handleCancel} style={styles.sheetAction}>
                <Text style={styles.sheetCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.sheetTitle}>{label}</Text>
              <Pressable onPress={handleDone} style={styles.sheetAction}>
                <Text style={styles.sheetDone}>Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={tempDate}
              mode="date"
              display="spinner"
              onChange={handleChange}
              minimumDate={minimumDate}
              maximumDate={maximumDate}
              style={styles.iosPicker}
            />
          </View>
        </Modal>
      )}

      {Platform.OS === "android" && showPicker && (
        <DateTimePicker
          value={toDate(value)}
          mode="date"
          display="default"
          onChange={handleChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: C.text, marginBottom: 8 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: C.surface,
  },
  btnText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 32,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.text },
  sheetAction: { paddingHorizontal: 4 },
  sheetCancel: { fontFamily: "Inter_500Medium", fontSize: 15, color: C.textSecondary },
  sheetDone: { fontFamily: "Inter_700Bold", fontSize: 15, color: C.accent },
  iosPicker: { height: 200 },
  webInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
  },
  calIcon: { marginRight: 8 },
  webInput: {
    flex: 1,
    paddingVertical: 14,
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: C.text,
  },
});
