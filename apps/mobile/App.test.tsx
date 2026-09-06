import { fireEvent, render, waitFor } from "@testing-library/react-native";
import App from "./App";

const mockRequestSignInLink = jest.fn();
const mockSignOut = jest.fn();

jest.mock("./src/config", () => ({
  nativeCryptoValidationEnabled: () => false,
  readMobileClientConfiguration: () => ({
    apiUrl: "https://api.example.test",
    webOrigin: "https://vault.example.test",
    authRedirectUrl: "rhasia-scret://auth/callback",
    supabaseUrl: "https://project.supabase.co",
    supabasePublishableKey: "publishable-key",
  }),
}));
jest.mock("./src/infrastructure/mobile-supabase-client", () => ({ createMobileSupabaseClient: () => ({}) }));
jest.mock("./src/infrastructure/native-authenticated-transport", () => ({ createNativeAuthenticatedTransport: () => ({}) }));
jest.mock("./src/presentation/use-mobile-session", () => ({
  useMobileSession: () => ({ session: null, status: "idle", requestSignInLink: mockRequestSignInLink, signOut: mockSignOut }),
}));

describe("mobile foundation presentation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders complete Indonesian copy and switches to English", async () => {
    const screen = await render(<App />);
    expect(screen.getByRole("header", { name: "Autentikator tanpa pengetahuan" })).toBeVisible();
    expect(screen.getByLabelText("Alamat email")).toBeVisible();

    await fireEvent.press(screen.getByRole("button", { name: "Gunakan English" }));
    expect(screen.getByRole("header", { name: "Zero-knowledge authenticator" })).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
  });

  it("keeps validation in the form model before requesting a sign-in link", async () => {
    const screen = await render(<App />);
    await fireEvent.press(screen.getByRole("button", { name: "Lanjutkan dengan email" }));
    expect(await screen.findByText("Masukkan alamat email.")).toBeVisible();
    expect(mockRequestSignInLink).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText("Alamat email"), "owner@example.test");
    await fireEvent.press(screen.getByRole("button", { name: "Lanjutkan dengan email" }));
    await waitFor(() => expect(mockRequestSignInLink).toHaveBeenCalledWith("owner@example.test"));
  });
});
