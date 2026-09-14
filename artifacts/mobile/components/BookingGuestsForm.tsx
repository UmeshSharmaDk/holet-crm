import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useMemo, useState } from "react";
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
import { DatePickerField } from "@/components/DatePickerField";

const C = Colors.light;

export interface IdImage {
  uri: string;
  name: string;
  type: string;
  file?: Blob;
}

export interface PersonDetail {
  name: string;
  dateOfBirth: string;
  relation: string;
  hasFrontId?: boolean;
  hasBackId?: boolean;
}

export interface IdUploadSlot {
  guestIndex: number | null;
  front?: IdImage;
  back?: IdImage;
  keepFrontId?: boolean;
  keepBackId?: boolean;
}

export interface BookingGuestsState {
  persons: PersonDetail[];
  idSlots: IdUploadSlot[];
}

export interface ExistingBookingGuest {
  personIndex: number;
  name: string;
  dateOfBirth: string | null;
  relation: string;
  hasFrontId: boolean;
  hasBackId: boolean;
}

export function emptyBookingGuests(count: number): BookingGuestsState {
  const safeCount = Math.max(1, Math.min(12, count));
  return {
    persons: Array.from({ length: safeCount }, (_, index) => ({
      name: "",
      dateOfBirth: "",
      relation: index === 0 ? "Main guest" : "",
    })),
    idSlots: Array.from({ length: safeCount }, () => ({ guestIndex: null })),
  };
}

export function resizeBookingGuests(
  value: BookingGuestsState,
  count: number,
): BookingGuestsState {
  const safeCount = Math.max(1, Math.min(12, count));
  const persons = Array.from({ length: safeCount }, (_, index) => ({
    name: value.persons[index]?.name ?? "",
    dateOfBirth: value.persons[index]?.dateOfBirth ?? "",
    relation: index === 0 ? "Main guest" : value.persons[index]?.relation ?? "",
    hasFrontId: value.persons[index]?.hasFrontId,
    hasBackId: value.persons[index]?.hasBackId,
  }));
  const idSlots = Array.from({ length: safeCount }, (_, index) => value.idSlots[index] ?? ({ guestIndex: null }));
  return { persons, idSlots };
}

export function bookingGuestsFromBooking(
  count: number,
  guests: ExistingBookingGuest[] | undefined,
): BookingGuestsState {
  const state = emptyBookingGuests(count);
  for (const guest of guests ?? []) {
    if (guest.personIndex < 0 || guest.personIndex >= state.persons.length) continue;
    state.persons[guest.personIndex] = {
      name: guest.name,
      dateOfBirth: guest.dateOfBirth ?? "",
      relation: guest.relation,
      hasFrontId: guest.hasFrontId,
      hasBackId: guest.hasBackId,
    };
    if (guest.hasFrontId || guest.hasBackId) {
      state.idSlots[guest.personIndex] = {
        guestIndex: guest.personIndex,
        keepFrontId: guest.hasFrontId,
        keepBackId: guest.hasBackId,
      };
    }
  }
  return state;
}

export function validateBookingGuests(
  value: BookingGuestsState,
  mainGuestName: string,
): string | null {
  if (!mainGuestName.trim()) return "Guest name is required";
  for (let index = 0; index < value.persons.length; index += 1) {
    const person = value.persons[index];
    if (index > 0 && !person.name.trim()) return `Name is required for Person ${index + 1}`;
    if (!person.dateOfBirth) return `Date of birth is required for ${index === 0 ? "the main guest" : `Person ${index + 1}`}`;
    if (index > 0 && !person.relation.trim()) return `Relation is required for Person ${index + 1}`;
  }
  return null;
}

export function bookingGuestsToFormData(
  value: BookingGuestsState,
  mainGuestName: string,
): FormData {
  const formData = new FormData();
  formData.append("guests", JSON.stringify(value.persons.map((person, personIndex) => ({
    personIndex,
    name: personIndex === 0 ? mainGuestName.trim() : person.name.trim(),
    dateOfBirth: person.dateOfBirth || null,
    relation: personIndex === 0 ? "Main guest" : person.relation.trim(),
    keepFrontId: Boolean(person.hasFrontId && !value.idSlots.some((slot) => slot.guestIndex === personIndex && slot.front)),
    keepBackId: Boolean(person.hasBackId && !value.idSlots.some((slot) => slot.guestIndex === personIndex && slot.back)),
  }))));

  value.idSlots.forEach((slot) => {
    if (slot.guestIndex === null) return;
    if (slot.front) appendImage(formData, `front_${slot.guestIndex}`, slot.front);
    if (slot.back) appendImage(formData, `back_${slot.guestIndex}`, slot.back);
  });
  return formData;
}

function appendImage(formData: FormData, fieldName: string, image: IdImage) {
  if (Platform.OS === "web" && image.file) {
    formData.append(fieldName, image.file, image.name);
  } else {
    formData.append(fieldName, {
      uri: image.uri,
      name: image.name,
      type: image.type,
    } as any);
  }
}

interface Props {
  mainGuestName: string;
  value: BookingGuestsState;
  onChange: (value: BookingGuestsState) => void;
}

export function BookingGuestsForm({ mainGuestName, value, onChange }: Props) {
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const names = useMemo(
    () => value.persons.map((person, index) => index === 0 ? (mainGuestName.trim() || "Main guest") : (person.name.trim() || `Person ${index + 1}`)),
    [mainGuestName, value.persons],
  );

  function updatePerson(index: number, field: keyof PersonDetail, nextValue: string) {
    const persons = value.persons.map((person, personIndex) =>
      personIndex === index ? { ...person, [field]: nextValue } : person,
    );
    onChange({ ...value, persons });
  }

  async function pickImage(slotIndex: number, side: "front" | "back") {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.75,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const image: IdImage = {
      uri: asset.uri,
      name: asset.fileName ?? `${side}-id-${Date.now()}.jpg`,
      type: asset.mimeType ?? "image/jpeg",
      ...(asset.file ? { file: asset.file } : {}),
    };
    const idSlots = value.idSlots.map((slot, index) => index === slotIndex
      ? { ...slot, [side]: image, ...(side === "front" ? { keepFrontId: false } : { keepBackId: false }) }
      : slot);
    onChange({ ...value, idSlots });
  }

  function selectGuest(slotIndex: number, guestIndex: number) {
    const previous = value.idSlots[slotIndex]?.guestIndex;
    const idSlots = value.idSlots.map((slot, index) => index === slotIndex
      ? {
        guestIndex,
        front: undefined,
        back: undefined,
        keepFrontId: Boolean(value.persons[guestIndex]?.hasFrontId && previous !== guestIndex),
        keepBackId: Boolean(value.persons[guestIndex]?.hasBackId && previous !== guestIndex),
      }
      : slot);
    onChange({ ...value, idSlots });
    setOpenSlot(null);
  }

  function availableGuests(slotIndex: number) {
    const assignedElsewhere = new Set(
      value.idSlots
        .filter((slot, index) => index !== slotIndex && slot.guestIndex !== null)
        .map((slot) => slot.guestIndex),
    );
    return names
      .map((name, index) => ({ name, index }))
      .filter((guest) => !assignedElsewhere.has(guest.index));
  }

  return (
    <View>
      <View style={styles.helperBanner}>
        <Feather name="users" size={17} color={C.accent} />
        <Text style={styles.helperText}>
          Add a profile for each person staying. The main guest is linked to the name above.
        </Text>
      </View>

      {value.persons.map((person, index) => (
        <View key={`person-${index}`} style={styles.personCard}>
          <View style={styles.personHeader}>
            <View style={styles.personNumber}>
              <Text style={styles.personNumberText}>{index + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.personTitle}>{index === 0 ? "Main guest" : `Person ${index + 1}`}</Text>
              <Text style={styles.personName}>{index === 0 ? (mainGuestName || "Enter the main guest name above") : (person.name || "Details required")}</Text>
            </View>
            {index === 0 && <View style={styles.mainBadge}><Text style={styles.mainBadgeText}>PRIMARY</Text></View>}
          </View>

          {index > 0 && (
            <Field
              label="Full name *"
              value={person.name}
              onChangeText={(text) => updatePerson(index, "name", text)}
              placeholder="Guest full name"
            />
          )}
          <DatePickerField
            label="Date of birth *"
            value={person.dateOfBirth}
            onChange={(date) => updatePerson(index, "dateOfBirth", date)}
            maximumDate={new Date()}
          />
          {index > 0 ? (
            <Field
              label="Relation with main guest *"
              value={person.relation}
              onChangeText={(text) => updatePerson(index, "relation", text)}
              placeholder="Example: Spouse, Child, Friend"
            />
          ) : (
            <View style={styles.relationNote}>
              <Feather name="link" size={15} color={C.textSecondary} />
              <Text style={styles.relationNoteText}>Relation: Main guest</Text>
            </View>
          )}
        </View>
      ))}

      <View style={styles.idHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.idTitle}>Identity documents</Text>
          <Text style={styles.idSubtitle}>Assign each slot to a different guest, then add both sides of their ID.</Text>
        </View>
        <Feather name="shield" size={20} color={C.gold} />
      </View>

      {value.idSlots.map((slot, slotIndex) => {
        const selectedName = slot.guestIndex === null ? "Select guest" : names[slot.guestIndex];
        return (
          <View key={`id-slot-${slotIndex}`} style={styles.idCard}>
            <View style={styles.idCardTop}>
              <Text style={styles.idSlotLabel}>ID {slotIndex + 1}</Text>
              <Text style={styles.idSlotHint}>{slot.guestIndex === null ? "Not assigned" : "Assigned"}</Text>
            </View>
            <Pressable style={styles.dropdown} onPress={() => setOpenSlot(slotIndex)}>
              <Feather name="user" size={16} color={C.accent} />
              <Text style={[styles.dropdownText, slot.guestIndex === null && styles.placeholderText]}>{selectedName}</Text>
              <Feather name="chevron-down" size={16} color={C.textSecondary} />
            </Pressable>
            <View style={styles.uploadRow}>
              <UploadButton label="Front side" image={slot.front} hasExisting={Boolean(slot.guestIndex !== null && value.persons[slot.guestIndex]?.hasFrontId && slot.keepFrontId)} onPress={() => pickImage(slotIndex, "front")} />
              <UploadButton label="Back side" image={slot.back} hasExisting={Boolean(slot.guestIndex !== null && value.persons[slot.guestIndex]?.hasBackId && slot.keepBackId)} onPress={() => pickImage(slotIndex, "back")} />
            </View>
            <Modal visible={openSlot === slotIndex} transparent animationType="fade" onRequestClose={() => setOpenSlot(null)}>
              <Pressable style={styles.modalOverlay} onPress={() => setOpenSlot(null)}>
                <Pressable style={styles.optionSheet} onPress={(event) => event.stopPropagation()}>
                  <View style={styles.sheetHeader}>
                    <Text style={styles.sheetTitle}>Assign ID {slotIndex + 1}</Text>
                    <Pressable onPress={() => setOpenSlot(null)}><Feather name="x" size={20} color={C.textSecondary} /></Pressable>
                  </View>
                  {availableGuests(slotIndex).map((guest) => (
                    <Pressable key={guest.index} style={styles.option} onPress={() => selectGuest(slotIndex, guest.index)}>
                      <View style={styles.optionAvatar}><Text style={styles.optionAvatarText}>{guest.name.charAt(0).toUpperCase()}</Text></View>
                      <Text style={styles.optionText}>{guest.name}</Text>
                      {slot.guestIndex === guest.index && <Feather name="check" size={18} color={C.accent} />}
                    </Pressable>
                  ))}
                </Pressable>
              </Pressable>
            </Modal>
          </View>
        );
      })}
    </View>
  );
}

function UploadButton({ label, image, hasExisting, onPress }: { label: string; image?: IdImage; hasExisting: boolean; onPress: () => void }) {
  const complete = Boolean(image || hasExisting);
  return (
    <Pressable style={[styles.uploadButton, complete && styles.uploadButtonComplete]} onPress={onPress}>
      <Feather name={complete ? "check-circle" : "upload"} size={16} color={complete ? C.success : C.accent} />
      <Text style={[styles.uploadText, complete && styles.uploadTextComplete]}>{image ? "Replace" : hasExisting ? "Uploaded" : label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChangeText, placeholder }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.textSecondary} />
    </View>
  );
}

const styles = StyleSheet.create({
  helperBanner: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.accentLight, borderRadius: 12, padding: 12, marginBottom: 12 },
  helperText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, color: C.textSecondary },
  personCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  personHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14 },
  personNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.primary, alignItems: "center", justifyContent: "center" },
  personNumberText: { fontFamily: "Inter_700Bold", fontSize: 13, color: C.surface },
  personTitle: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text },
  personName: { fontFamily: "Inter_400Regular", fontSize: 12, color: C.textSecondary, marginTop: 2 },
  mainBadge: { backgroundColor: C.accentLight, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 },
  mainBadgeText: { fontFamily: "Inter_700Bold", fontSize: 9, color: C.accent, letterSpacing: 0.5 },
  field: { marginBottom: 12 },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: C.text, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, padding: 12, fontFamily: "Inter_400Regular", fontSize: 14, color: C.text, backgroundColor: C.surface },
  relationNote: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 12, marginBottom: 2 },
  relationNoteText: { fontFamily: "Inter_500Medium", fontSize: 13, color: C.textSecondary },
  idHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10, marginBottom: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border },
  idTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  idSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17, color: C.textSecondary, marginTop: 3 },
  idCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 14, marginBottom: 10 },
  idCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 9 },
  idSlotLabel: { fontFamily: "Inter_700Bold", fontSize: 14, color: C.text },
  idSlotHint: { fontFamily: "Inter_500Medium", fontSize: 11, color: C.textSecondary },
  dropdown: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: C.surfaceSecondary },
  dropdownText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, color: C.text },
  placeholderText: { color: C.textSecondary },
  uploadRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  uploadButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: C.accent, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 5 },
  uploadButtonComplete: { borderColor: C.success, backgroundColor: C.successLight },
  uploadText: { fontFamily: "Inter_600SemiBold", fontSize: 11, color: C.accent },
  uploadTextComplete: { color: C.success },
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15, 23, 42, 0.35)" },
  optionSheet: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 4 },
  sheetTitle: { fontFamily: "Inter_700Bold", fontSize: 16, color: C.text },
  option: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  optionAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.accentLight, justifyContent: "center", alignItems: "center" },
  optionAvatarText: { fontFamily: "Inter_700Bold", fontSize: 13, color: C.accent },
  optionText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14, color: C.text },
});