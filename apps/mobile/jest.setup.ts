jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    fetch: async () => ({ isConnected: true, isInternetReachable: true }),
    addEventListener: () => () => undefined,
  },
}));

jest.mock("./modules/native-argon2id", () => ({
  argon2id: jest.fn(),
  randomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => (index + 1) & 0xff),
}));
