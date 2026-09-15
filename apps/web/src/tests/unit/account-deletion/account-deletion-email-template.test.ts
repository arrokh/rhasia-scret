import { describe, expect, it } from "vitest";
import {
  renderAccountDeletionCompletionEmail,
  renderAccountDeletionOtpEmail,
} from "@/modules/account-deletion/infrastructure/account-deletion-email-template";

describe("account-deletion email templates", () => {
  it("renders the English OTP email in the shared layout", () => {
    const content = renderAccountDeletionOtpEmail({
      recipientEmail: "owner@example.test",
      otp: "123456",
    });

    expect(content.subject).toBe("Confirm your rhasia-scret account deletion");
    expect(content.text).toContain("Account deletion verification");
    expect(content.text).toContain("Verification code: 123456");
    expect(content.text).not.toContain("Verifikasi penghapusan akun");
    expect(content.html).toContain('<html lang="en">');
    expect(content.html).toContain("background-color:#f8f4ed");
    expect(content.html).toContain("background-color:#f1eee9");
    expect(content.html).toContain("#e5a72e");
    expect(content.html).toContain("123456");
    expect(content.html).toContain("font-size:30px;line-height:36px;font-weight:700");
    expect(content.html).toContain("rhasia-");
    expect(content.html).toContain("nooroctavian.id");
  });

  it("renders and escapes the opaque completion receipt", () => {
    const content = renderAccountDeletionCompletionEmail({
      recipientEmail: "owner@example.test",
      receiptId: "receipt<&\"'",
    });

    expect(content.subject).toBe("Your rhasia-scret account was deleted");
    expect(content.text).toContain("Receipt ID: receipt<&\"'");
    expect(content.html).toContain("Receipt ID");
    expect(content.html).toContain("receipt&lt;&amp;&quot;&#39;");
    expect(content.html).not.toContain("receipt<&\"'");
    expect(content.html).toContain("border-left:3px solid #e5a72e");
  });
});
