import { fireEvent, render } from "@testing-library/react-native";
import { translate } from "../localization";
import { MobileQrScanner } from "./mobile-qr-scanner";

const mockRequestPermission = jest.fn(async () => ({ granted: true }));
let mockGranted = true;
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [{ granted: mockGranted }, mockRequestPermission],
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned(event: { data: string }): void }) => {
    const React = jest.requireActual<typeof import("react")>("react");
    const Native = jest.requireActual<typeof import("react-native")>("react-native");
    return React.createElement(
      Native.Pressable,
      {
        accessibilityRole: "button",
        onPress: () => onBarcodeScanned({ data: "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example" }),
      },
      React.createElement(Native.Text, null, "Mock camera preview"),
    );
  },
}));

describe("MobileQrScanner", () => {
  beforeEach(() => {
    mockGranted = true;
    mockRequestPermission.mockClear();
  });

  it("delivers raw QR data only to the client callback and accepts a scan once", async () => {
    const onScan = jest.fn();
    const screen = await render(<MobileQrScanner copy={translate("en")} onCancel={() => undefined} onScan={onScan} />);
    const preview = screen.getByRole("button", { name: "Mock camera preview" });

    await fireEvent.press(preview);
    await fireEvent.press(preview);

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith("otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example");
  });

  it("requests permission only after an explicit user action", async () => {
    mockGranted = false;
    const screen = await render(<MobileQrScanner copy={translate("id")} onCancel={() => undefined} onScan={() => undefined} />);

    expect(mockRequestPermission).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Izinkan kamera" }));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
  });
});
