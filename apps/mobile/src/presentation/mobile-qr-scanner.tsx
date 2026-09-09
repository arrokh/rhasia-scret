import { useRef, type ComponentType } from "react";
import { CameraView, type BarcodeScanningResult, type CameraViewProps, useCameraPermissions } from "expo-camera";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileMessages } from "../localization";

const CameraPreview = CameraView as unknown as ComponentType<CameraViewProps>;

export function MobileQrScanner({
  copy,
  onCancel,
  onScan,
}: {
  copy: MobileMessages;
  onCancel(): void;
  onScan(uri: string): void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const accepted = useRef(false);

  if (!permission)
    return (
      <Text accessibilityLiveRegion="polite" style={styles.guidance}>
        {copy.cameraPermissionChecking}
      </Text>
    );
  if (!permission.granted) {
    return (
      <View style={styles.panel}>
        <Text style={styles.guidance}>{copy.cameraPermissionGuidance}</Text>
        <Pressable accessibilityRole="button" onPress={() => void requestPermission()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{copy.allowCamera}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{copy.cancelQrScan}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.heading}>
        {copy.scanAuthenticatorQr}
      </Text>
      <Text style={styles.guidance}>{copy.qrScanClientOnly}</Text>
      <CameraPreview
        accessibilityLabel={copy.cameraPreview}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }: BarcodeScanningResult) => {
          if (accepted.current || !data.startsWith("otpauth://")) return;
          accepted.current = true;
          onScan(data);
        }}
        style={styles.camera}
      />
      <Pressable accessibilityRole="button" onPress={onCancel} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>{copy.cancelQrScan}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  heading: { color: "#172027", fontSize: 18, fontWeight: "800" },
  guidance: { color: "#526D82", fontSize: 14, lineHeight: 20 },
  camera: { width: "100%", aspectRatio: 1, borderRadius: 16, overflow: "hidden" },
  primaryButton: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#D99412",
    paddingHorizontal: 16,
  },
  primaryButtonText: { color: "#172027", fontWeight: "800" },
  secondaryButton: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DED8CE",
    paddingHorizontal: 14,
  },
  secondaryButtonText: { color: "#172027", fontWeight: "700" },
});
