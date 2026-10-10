import { Image, Platform } from "react-native";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import type { IdImage } from "@/components/BookingGuestsForm";

// Stay below the API's 2 MiB per-file ceiling without relaxing its memory limits.
const TARGET_BYTES = 1.8 * 1024 * 1024;

/** Prepare uploads, not the draft: originals remain available if saving fails. */
export async function prepareIdImage(image: IdImage): Promise<IdImage> {
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      Image.getSize(image.uri, (width, height) => resolve({ width, height }), reject);
    });
    if (!dimensions.width || !dimensions.height) throw new Error("Invalid image dimensions");
    for (const [maxSide, quality] of [[2200, 0.9], [1800, 0.85], [1400, 0.8]] as const) {
      const scale = Math.min(1, maxSide / Math.max(dimensions.width, dimensions.height));
      const result = await manipulateAsync(image.uri, [{
        resize: { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) },
      }], { format: SaveFormat.JPEG, compress: quality, base64: true });
      if (!result.base64) throw new Error("Image encoding failed");
      const size = result.base64.length * 3 / 4 - (result.base64.endsWith("==") ? 2 : result.base64.endsWith("=") ? 1 : 0);
      if (size > TARGET_BYTES) {
        if (Platform.OS === "web") URL.revokeObjectURL(result.uri);
        continue;
      }
      if (Platform.OS === "web") {
        try {
          const response = await fetch(result.uri);
          const file = await response.blob();
          if (!file.size || file.size > TARGET_BYTES) throw new Error("Invalid prepared image");
          return { uri: image.uri, name: "identity.jpg", type: "image/jpeg", file };
        } finally {
          URL.revokeObjectURL(result.uri);
        }
      }
      return { uri: result.uri, name: "identity.jpg", type: "image/jpeg" };
    }
    throw new Error("Image is still too large");
  } catch {
    throw new Error("This identity photo could not be prepared for upload. Select a clear JPEG or PNG photo and try saving again. Your guest details and selected photos have been kept.");
  }
}
