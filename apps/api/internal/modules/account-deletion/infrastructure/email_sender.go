package infrastructure

import (
	"context"
	"errors"
	"fmt"
	"html"
	"strings"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
	accountapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/account-deletion/application"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
)

const (
	deletionOTPEmailSubject        = "Confirm your rhasia-scret account deletion"
	deletionCompletionEmailSubject = "Your rhasia-scret account was deleted"
	deletionEmailTitle             = "Account deletion verification"
	deletionEmailDescription       = "Use this one-time code to permanently delete your hosted rhasia-scret account:"
	deletionEmailCode              = "Verification code"
	deletionEmailExpiry            = "This code expires in 10 minutes and can be used once."
	deletionEmailIgnore            = "If you did not request account deletion, sign in and secure your account."
	deletionCompletionTitle        = "Your rhasia-scret account was deleted"
	deletionCompletionDescription  = "The hosted account and its server-side data were permanently deleted. This email contains your receipt only."
	deletionEmailReceipt           = "Receipt ID"
)

type SMTPEmailSender struct {
	delivery identity.EmailDelivery
}

func NewSMTPEmailSender(delivery identity.EmailDelivery) (*SMTPEmailSender, error) {
	if delivery == nil {
		return nil, errors.New("account deletion email delivery is not configured")
	}
	return &SMTPEmailSender{delivery: delivery}, nil
}

func (sender *SMTPEmailSender) SendDeletionOTP(ctx context.Context, recipient string, otp string, locale localization.Locale) error {
	if !accountapp.ValidPasswordlessOTP(otp) {
		return errors.New("account deletion email OTP is invalid")
	}
	if err := sender.delivery.SendEmail(ctx, recipient, renderDeletionOTPEmail(otp, locale)); err != nil {
		return errors.New("account deletion OTP email delivery failed")
	}
	return nil
}

func (sender *SMTPEmailSender) SendDeletionCompletion(ctx context.Context, recipient string, receiptID string, locale localization.Locale) error {
	if receiptID == "" {
		return errors.New("account deletion email receipt is invalid")
	}
	if err := sender.delivery.SendEmail(ctx, recipient, renderDeletionCompletionEmail(receiptID, locale)); err != nil {
		return errors.New("account deletion completion email delivery failed")
	}
	return nil
}

type deletionEmailCopy struct {
	Language              string
	FooterBy              string
	OTPSubject            string
	CompletionSubject     string
	Title                 string
	Description           string
	Code                  string
	Expiry                string
	Ignore                string
	CompletionTitle       string
	CompletionDescription string
	Receipt               string
}

func deletionCopy(locale localization.Locale) deletionEmailCopy {
	if localization.ResolveLocale(string(locale)) == localization.English {
		return deletionEmailCopy{
			Language: "en", FooterBy: "by", OTPSubject: deletionOTPEmailSubject, CompletionSubject: deletionCompletionEmailSubject,
			Title: deletionEmailTitle, Description: deletionEmailDescription, Code: deletionEmailCode, Expiry: deletionEmailExpiry,
			Ignore: deletionEmailIgnore, CompletionTitle: deletionCompletionTitle, CompletionDescription: deletionCompletionDescription,
			Receipt: deletionEmailReceipt,
		}
	}
	return deletionEmailCopy{
		Language: "id", FooterBy: "oleh", OTPSubject: "Konfirmasi penghapusan akun rhasia-scret",
		CompletionSubject: "Akun rhasia-scret Anda telah dihapus", Title: "Verifikasi penghapusan akun",
		Description: "Gunakan kode satu kali ini untuk menghapus permanen akun hosted rhasia-scret Anda:",
		Code:        "Kode verifikasi", Expiry: "Kode ini kedaluwarsa dalam 10 menit dan hanya dapat digunakan sekali.",
		Ignore:                "Jika Anda tidak meminta penghapusan akun, masuk dan amankan akun Anda.",
		CompletionTitle:       "Akun rhasia-scret Anda telah dihapus",
		CompletionDescription: "Akun hosted dan data servernya telah dihapus permanen. Email ini hanya berisi tanda terima Anda.",
		Receipt:               "ID tanda terima",
	}
}

func renderDeletionOTPEmail(otp string, locale localization.Locale) identity.EmailMessage {
	copy := deletionCopy(locale)
	text := strings.Join([]string{
		copy.Title,
		copy.Description,
		copy.Code + ": " + otp,
		copy.Expiry,
		copy.Ignore,
	}, "\n\n")
	content := strings.Join([]string{
		fmt.Sprintf(`<h1 style="margin:0 0 12px;color:#171d22;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.02em;">%s</h1>`, html.EscapeString(copy.Title)),
		fmt.Sprintf(`<p style="margin:0 0 24px;color:#273039;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:16px;line-height:24px;">%s</p>`, html.EscapeString(copy.Description)),
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 20px;">`,
		"  <tr>",
		`    <td align="center" style="padding:20px 16px;border:1px solid #ded8d0;border-radius:12px;background-color:#f1eee9;">`,
		fmt.Sprintf(`      <p style="margin:0 0 8px;color:#737b81;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:0.08em;">%s</p>`, html.EscapeString(copy.Code)),
		fmt.Sprintf(`      <p style="margin:0;color:#171d22;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:30px;line-height:36px;font-weight:700;letter-spacing:0.3em;">%s</p>`, html.EscapeString(otp)),
		"    </td>",
		"  </tr>",
		"</table>",
		fmt.Sprintf(`<p style="margin:0 0 16px;color:#737b81;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:14px;line-height:20px;">%s</p>`, html.EscapeString(copy.Expiry)),
		fmt.Sprintf(`<p style="margin:0;color:#737b81;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:12px;line-height:16px;">%s</p>`, html.EscapeString(copy.Ignore)),
	}, "\n")
	return identity.EmailMessage{Subject: copy.OTPSubject, Text: text, HTML: renderDeletionEmailLayout(copy.OTPSubject, content, copy)}
}

func renderDeletionCompletionEmail(receiptID string, locale localization.Locale) identity.EmailMessage {
	copy := deletionCopy(locale)
	text := strings.Join([]string{
		copy.CompletionTitle,
		copy.CompletionDescription,
		copy.Receipt + ": " + receiptID,
	}, "\n\n")
	content := strings.Join([]string{
		fmt.Sprintf(`<h1 style="margin:0 0 12px;color:#171d22;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.02em;">%s</h1>`, html.EscapeString(copy.CompletionTitle)),
		fmt.Sprintf(`<p style="margin:0 0 24px;color:#273039;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:16px;line-height:24px;">%s</p>`, html.EscapeString(copy.CompletionDescription)),
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0;">`,
		"  <tr>",
		`    <td style="padding:16px;border-left:3px solid #e5a72e;border-radius:8px;background-color:#f1eee9;">`,
		fmt.Sprintf(`      <p style="margin:0 0 8px;color:#737b81;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:12px;line-height:16px;text-transform:uppercase;letter-spacing:0.08em;">%s</p>`, html.EscapeString(copy.Receipt)),
		fmt.Sprintf(`      <p style="margin:0;color:#171d22;font-family:Manrope, Arial, Helvetica, sans-serif;font-size:16px;line-height:24px;font-weight:700;overflow-wrap:anywhere;word-break:break-all;">%s</p>`, html.EscapeString(receiptID)),
		"    </td>",
		"  </tr>",
		"</table>",
	}, "\n")
	return identity.EmailMessage{Subject: copy.CompletionSubject, Text: text, HTML: renderDeletionEmailLayout(copy.CompletionSubject, content, copy)}
}

func renderDeletionEmailLayout(subject string, content string, copy deletionEmailCopy) string {
	const wordmark = `<span style="color:#273039;">rhasia-</span><span style="color:#e5a72e;">scret</span>`
	return strings.Join([]string{
		"<!doctype html>",
		fmt.Sprintf(`<html lang="%s">`, copy.Language),
		"<head>",
		`<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">`,
		`<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
		"<title>" + html.EscapeString(subject) + "</title>",
		"</head>",
		`<body style="margin:0;background-color:#f8f4ed;color:#273039;font-family:Manrope, Arial, Helvetica, sans-serif;-webkit-text-size-adjust:100%;">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f8f4ed;">`,
		"  <tr>",
		`    <td align="center" style="padding:24px 16px 40px;">`,
		`<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border:1px solid #ded8d0;border-top:4px solid #e5a72e;border-radius:16px;background-color:#fffdf9;box-shadow:0 1px 2px rgba(23,29,34,0.04),0 8px 24px rgba(23,29,34,0.06);">`,
		"  <tr>",
		`    <td align="center" style="padding:20px 32px 18px;border-bottom:1px solid #e5e3df;">`,
		`      <div style="font-size:18px;line-height:22px;font-weight:700;letter-spacing:-0.02em;">` + wordmark + `</div>`,
		"    </td>",
		"  </tr>",
		"  <tr>",
		`    <td style="padding:32px;">`,
		content,
		"    </td>",
		"  </tr>",
		"  <tr>",
		`    <td align="center" style="padding:16px 32px 20px;border-top:1px solid #e5e3df;color:#737b81;">`,
		`      <p style="margin:0;color:#737b81;font-size:12px;line-height:16px;">` + wordmark + ` <span>` + html.EscapeString(copy.FooterBy) + `</span> <a href="https://nooroctavian.id/" style="color:#273039;font-weight:700;text-decoration:none;">nooroctavian.id</a></p>`,
		"    </td>",
		"  </tr>",
		"</table>",
		"    </td>",
		"  </tr>",
		"</table>",
		"</body>",
		"</html>",
	}, "\n")
}

var (
	_ accountapp.PasswordlessOTPEmailSender = (*SMTPEmailSender)(nil)
	_ accountapp.CompletionEmailSender      = (*SMTPEmailSender)(nil)
)
