import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { getAuthToken } from "./secureStorage";

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "";

export async function exportBookingDocument(id: number, mode: "download" | "print") {
  // Open synchronously within the tap to avoid browser popup blocking.
  const viewer = Platform.OS === "web" && mode === "print" ? window.open("", "_blank") : null;
  if (Platform.OS === "web" && mode === "print" && !viewer) {
    throw new Error("Please allow popups to open the printable booking PDF.");
  }
  if (viewer) viewer.document.body.textContent = "Preparing booking PDF…";
  let localUri: string | null = null;
  try {
    const token = await getAuthToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const url = `${BASE_URL}/api/bookings/${id}/pdf`;
    if (Platform.OS === "web") {
      const response = await fetch(url, { credentials: "include", headers, cache: "no-store" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message ?? "Unable to export the booking PDF.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (viewer) {
        // The browser's PDF viewer provides both printing and Save as PDF.
        viewer.location.replace(objectUrl);
      } else {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `booking-${id}.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
      return;
    }
    if (!FileSystem.cacheDirectory) throw new Error("Local PDF storage is unavailable.");
    localUri = `${FileSystem.cacheDirectory}booking-${id}-${Date.now()}.pdf`;
    const result = await FileSystem.downloadAsync(url, localUri, { headers });
    if (result.status !== 200) {
      const errorText = await FileSystem.readAsStringAsync(localUri);
      let message = "Unable to export the booking PDF.";
      try { message = JSON.parse(errorText).message ?? message; } catch {}
      throw new Error(message);
    }
    if (mode === "print") {
      await Print.printAsync({ uri: localUri });
    } else if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(localUri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: "Save or share booking PDF" });
    } else {
      throw new Error("PDF sharing is not available on this device. Use Print instead.");
    }
  } catch (error) {
    viewer?.close();
    throw error;
  } finally {
    // Identity scans are sensitive; do not leave an exported copy in app cache.
    if (localUri) await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
  }
}
