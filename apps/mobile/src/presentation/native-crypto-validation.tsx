import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ARGON2ID_PROTOCOL_VECTOR } from "@rhasia-scret/client-vault-core";
import { nativeArgon2idPort } from "../infrastructure/native-argon2id";
import { nativeCryptoPrimitives } from "../infrastructure/native-crypto-primitives";
import { translate } from "../localization";

export function NativeCryptoValidation() {
  const [status, setStatus] = useState<"running" | "passed" | "failed">("running");
  const id = translate("id");
  const en = translate("en");

  useEffect(() => {
    let active = true;
    void validateNativeCrypto().then(
      () => {
        if (active) setStatus("passed");
      },
      () => {
        if (active) setStatus("failed");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <View style={styles.page}>
      <Text accessibilityRole="header" style={styles.title}>
        {id.nativeValidationTitle} / {en.nativeValidationTitle}
      </Text>
      <Text accessibilityLiveRegion="assertive" style={status === "failed" ? styles.failed : styles.status}>
        {status === "running"
          ? `${id.nativeValidationRunning} / ${en.nativeValidationRunning}`
          : status === "passed"
            ? `${id.nativeValidationPassed} / ${en.nativeValidationPassed}`
            : `${id.nativeValidationFailed} / ${en.nativeValidationFailed}`}
      </Text>
      <Text style={styles.description}>
        {id.nativeValidationDescription} / {en.nativeValidationDescription}
      </Text>
    </View>
  );
}

async function validateNativeCrypto(): Promise<void> {
  const random = nativeCryptoPrimitives.randomBytes(32);
  if (random.length !== 32 || random.every((value) => value === 0))
    throw new Error("Native secure random validation failed.");
  random.fill(0);
  const actual = await nativeArgon2idPort.deriveArgon2id(
    ARGON2ID_PROTOCOL_VECTOR.secret,
    ARGON2ID_PROTOCOL_VECTOR.salt,
    {
      memoryKiB: ARGON2ID_PROTOCOL_VECTOR.memoryKiB,
      iterations: ARGON2ID_PROTOCOL_VECTOR.iterations,
      parallelism: ARGON2ID_PROTOCOL_VECTOR.parallelism,
      outputBytes: ARGON2ID_PROTOCOL_VECTOR.outputBytes,
    },
  );
  try {
    const hex = Array.from(actual, (value) => value.toString(16).padStart(2, "0")).join("");
    if (hex !== ARGON2ID_PROTOCOL_VECTOR.expectedHex) throw new Error("Native Argon2id vector mismatch.");
  } finally {
    actual.fill(0);
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: "center", gap: 24, padding: 32, backgroundColor: "#F9F6F0" },
  title: { color: "#172027", fontSize: 28, lineHeight: 36, fontWeight: "800", textAlign: "center" },
  status: { color: "#2F6B49", fontSize: 30, fontWeight: "900", textAlign: "center" },
  failed: { color: "#A4433D", fontSize: 30, fontWeight: "900", textAlign: "center" },
  description: { color: "#526D82", fontSize: 16, lineHeight: 24, textAlign: "center" },
});
