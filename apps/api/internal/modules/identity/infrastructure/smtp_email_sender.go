package infrastructure

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	identity "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity"
	identityapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/modules/identity/application"
)

type SMTPEnvironment struct {
	Host        string
	Port        string
	Production  bool
	Secure      string
	RequireTLS  *string
	Username    string
	Password    string
	TLSCA       string
	FromAddress string
	FromName    *string
}

type SMTPConfiguration struct {
	Host       string
	Port       int
	Production bool
	Secure     bool
	RequireTLS bool
	Username   string
	Password   string
	TLSCA      []byte
	From       mail.Address
}

type SMTPEmailSender struct {
	configuration SMTPConfiguration
}

func ReadSMTPConfiguration(environment SMTPEnvironment) (SMTPConfiguration, error) {
	host := strings.TrimSpace(environment.Host)
	if host == "" {
		return SMTPConfiguration{}, errors.New("SMTP_HOST is required")
	}
	if containsUnicodeSpace(host) {
		return SMTPConfiguration{}, errors.New("SMTP_HOST must not contain whitespace")
	}
	port, err := readSMTPPort(environment.Port)
	if err != nil {
		return SMTPConfiguration{}, err
	}
	if environment.Production && port != 465 && port != 587 {
		return SMTPConfiguration{}, fmt.Errorf("SMTP_PORT %d is not allowed in production; use 465 or 587", port)
	}
	secure, err := readSMTPBoolean(environment.Secure, "SMTP_SECURE")
	if err != nil {
		return SMTPConfiguration{}, err
	}
	requireTLS := true
	if environment.RequireTLS != nil {
		requireTLS, err = readSMTPBoolean(*environment.RequireTLS, "SMTP_REQUIRE_TLS")
		if err != nil {
			return SMTPConfiguration{}, err
		}
	}
	username := strings.TrimSpace(environment.Username)
	if username == "" {
		return SMTPConfiguration{}, errors.New("SMTP_USER is required")
	}
	if environment.Password == "" {
		return SMTPConfiguration{}, errors.New("SMTP_PASSWORD is required")
	}
	if secure && port != 465 {
		return SMTPConfiguration{}, errors.New("SMTP_SECURE requires SMTP_PORT 465")
	}
	if !secure && port == 465 {
		return SMTPConfiguration{}, errors.New("SMTP_PORT 465 requires SMTP_SECURE=true")
	}
	if !secure && !requireTLS {
		return SMTPConfiguration{}, errors.New("SMTP_REQUIRE_TLS must be true for non-implicit TLS SMTP")
	}
	ca, err := readSMTPCA(environment.TLSCA)
	if err != nil {
		return SMTPConfiguration{}, err
	}
	fromAddress, err := readSMTPEmail(environment.FromAddress)
	if err != nil {
		return SMTPConfiguration{}, err
	}
	fromName := "rhasia-scret"
	if environment.FromName != nil {
		fromName = *environment.FromName
	}
	if fromName == "" || strings.ContainsAny(fromName, "\r\n") {
		return SMTPConfiguration{}, errors.New("AUTH_EMAIL_FROM_NAME must not be empty or contain newlines")
	}
	return SMTPConfiguration{
		Host:       host,
		Port:       port,
		Production: environment.Production,
		Secure:     secure,
		RequireTLS: requireTLS,
		Username:   username,
		Password:   environment.Password,
		TLSCA:      ca,
		From:       mail.Address{Name: fromName, Address: fromAddress},
	}, nil
}

func NewSMTPEmailSender(configuration SMTPConfiguration) (*SMTPEmailSender, error) {
	if configuration.Host == "" || configuration.Port < 1 || configuration.Port > 65_535 || configuration.Username == "" || configuration.Password == "" || configuration.From.Address == "" {
		return nil, errors.New("SMTP email delivery is not configured")
	}
	if configuration.Production && configuration.Port != 465 && configuration.Port != 587 ||
		configuration.Secure != (configuration.Port == 465) ||
		!configuration.Secure && !configuration.RequireTLS {
		return nil, errors.New("SMTP TLS policy is invalid")
	}
	return &SMTPEmailSender{configuration: configuration}, nil
}

func (sender *SMTPEmailSender) SendMagicLink(ctx context.Context, recipient string, actionURL *url.URL) error {
	if !isSafeMagicLinkURL(actionURL) {
		return errors.New("magic-link email request is invalid")
	}
	content := renderMagicLinkEmail(actionURL.String())
	if err := sender.SendEmail(ctx, recipient, identity.EmailMessage{Subject: content.Subject, Text: content.Text, HTML: content.HTML}); err != nil {
		return errors.New("magic-link email delivery failed")
	}
	return nil
}

func (sender *SMTPEmailSender) SendEmail(ctx context.Context, recipient string, content identity.EmailMessage) error {
	if !isSMTPEmail(recipient) || content.Subject == "" || strings.ContainsAny(content.Subject, "\r\n") || content.Text == "" || content.HTML == "" {
		return errors.New("SMTP email message is invalid")
	}
	message, err := renderSMTPMessage(sender.configuration.From, recipient, content.Subject, content.Text, content.HTML)
	if err != nil {
		return errors.New("SMTP email message could not be prepared")
	}
	if err := sender.deliver(ctx, recipient, message); err != nil {
		return errors.New("SMTP email delivery failed")
	}
	return nil
}

func (sender *SMTPEmailSender) deliver(ctx context.Context, recipient string, message []byte) error {
	address := net.JoinHostPort(sender.configuration.Host, strconv.Itoa(sender.configuration.Port))
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return errors.New("connect to SMTP server")
	}
	defer connection.Close()
	if sender.configuration.Secure {
		tlsConfiguration, tlsErr := sender.tlsConfiguration()
		if tlsErr != nil {
			return tlsErr
		}
		handshakeContext, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		tlsConnection := tls.Client(connection, tlsConfiguration)
		if err := tlsConnection.HandshakeContext(handshakeContext); err != nil {
			return errors.New("establish implicit SMTP TLS connection")
		}
		connection = tlsConnection
	}
	deadline := time.Now().Add(15 * time.Second)
	if contextDeadline, ok := ctx.Deadline(); ok && contextDeadline.Before(deadline) {
		deadline = contextDeadline
	}
	if err := connection.SetDeadline(deadline); err != nil {
		return errors.New("configure SMTP connection timeout")
	}
	stopCancellation := context.AfterFunc(ctx, func() { _ = connection.Close() })
	defer stopCancellation()
	client, err := smtp.NewClient(connection, sender.configuration.Host)
	if err != nil {
		return errors.New("initialize SMTP connection")
	}
	defer client.Close()
	if !sender.configuration.Secure {
		if supported, _ := client.Extension("STARTTLS"); !supported {
			return errors.New("SMTP server does not support required TLS")
		}
		tlsConfiguration, tlsErr := sender.tlsConfiguration()
		if tlsErr != nil {
			return tlsErr
		}
		if err := client.StartTLS(tlsConfiguration); err != nil {
			return errors.New("establish SMTP TLS connection")
		}
	}
	if err := client.Auth(smtpPasswordAuth{username: sender.configuration.Username, password: sender.configuration.Password, host: sender.configuration.Host, implicitTLS: sender.configuration.Secure}); err != nil {
		return errors.New("authenticate to SMTP server")
	}
	if err := client.Mail(sender.configuration.From.Address); err != nil {
		return errors.New("set SMTP sender")
	}
	if err := client.Rcpt(recipient); err != nil {
		return errors.New("set SMTP recipient")
	}
	dataWriter, err := client.Data()
	if err != nil {
		return errors.New("open SMTP message body")
	}
	if _, err := dataWriter.Write(message); err != nil {
		_ = dataWriter.Close()
		return errors.New("write SMTP message body")
	}
	if err := dataWriter.Close(); err != nil {
		return errors.New("finish SMTP message delivery")
	}
	if err := client.Quit(); err != nil {
		return errors.New("close SMTP connection")
	}
	return nil
}

func (sender *SMTPEmailSender) tlsConfiguration() (*tls.Config, error) {
	configuration := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: sender.configuration.Host}
	if len(sender.configuration.TLSCA) == 0 {
		return configuration, nil
	}
	roots, err := x509.SystemCertPool()
	if err != nil || roots == nil {
		roots = x509.NewCertPool()
	}
	if !roots.AppendCertsFromPEM(sender.configuration.TLSCA) {
		return nil, errors.New("SMTP_TLS_CA does not contain a parseable certificate")
	}
	configuration.RootCAs = roots
	return configuration, nil
}

type smtpPasswordAuth struct {
	username    string
	password    string
	host        string
	implicitTLS bool
}

func (auth smtpPasswordAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if server.Name != auth.host || !server.TLS && !auth.implicitTLS {
		return "", nil, errors.New("SMTP authentication requires a verified TLS connection")
	}
	credentials := []byte{0}
	credentials = append(credentials, auth.username...)
	credentials = append(credentials, 0)
	credentials = append(credentials, auth.password...)
	return "PLAIN", credentials, nil
}

func (smtpPasswordAuth) Next(_ []byte, more bool) ([]byte, error) {
	if more {
		return nil, errors.New("unexpected SMTP authentication challenge")
	}
	return nil, nil
}

func readSMTPPort(raw string) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return 0, errors.New("SMTP_PORT is required")
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, errors.New("SMTP_PORT must be a number between 1 and 65535")
		}
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65_535 {
		return 0, errors.New("SMTP_PORT must be a number between 1 and 65535")
	}
	return port, nil
}

func readSMTPBoolean(value string, name string) (bool, error) {
	switch value {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("%s must be true or false", name)
	}
}

func readSMTPCA(raw string) ([]byte, error) {
	encoded := strings.TrimSpace(raw)
	if encoded == "" {
		return nil, nil
	}
	if len(encoded) > 16_384 {
		return nil, errors.New("SMTP_TLS_CA must be a bounded base64-encoded certificate")
	}
	certificate, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || !strings.HasPrefix(string(certificate), "-----BEGIN CERTIFICATE-----") || !strings.Contains(string(certificate), "-----END CERTIFICATE-----") {
		return nil, errors.New("SMTP_TLS_CA must contain a base64-encoded PEM certificate")
	}
	return certificate, nil
}

func readSMTPEmail(raw string) (string, error) {
	address := strings.TrimSpace(raw)
	if !isSMTPEmail(address) {
		return "", errors.New("AUTH_EMAIL_FROM must be a valid email address")
	}
	return address, nil
}

func isSMTPEmail(value string) bool {
	if len(value) == 0 || len(value) > 254 {
		return false
	}
	at := -1
	for index, character := range value {
		if character == '@' {
			if at >= 0 {
				return false
			}
			at = index
		}
		if unicode.IsSpace(character) || character == 13 || character == 10 {
			return false
		}
	}
	return at > 0 && at < len(value)-1 && strings.Contains(value[at+1:], ".") && !strings.HasPrefix(value[at+1:], ".") && !strings.HasSuffix(value, ".")
}

func containsUnicodeSpace(value string) bool {
	for _, character := range value {
		if unicode.IsSpace(character) {
			return true
		}
	}
	return false
}

func isSafeMagicLinkURL(value *url.URL) bool {
	if value == nil || value.Hostname() == "" || value.User != nil || value.RawQuery != "" || value.ForceQuery || !strings.HasPrefix(value.Fragment, "token=") {
		return false
	}
	if value.Scheme != "https" && !(value.Scheme == "http" && (value.Hostname() == "localhost" || value.Hostname() == "127.0.0.1")) {
		return false
	}
	pwa := value.Path == "/auth/pwa-confirm"
	if value.Path != "/auth/confirm" && !pwa {
		return false
	}
	fragment, err := url.ParseQuery(value.Fragment)
	if err != nil {
		return false
	}
	for key := range fragment {
		if key != "token" && key != "next" && key != "handoff" {
			return false
		}
	}
	tokens := fragment["token"]
	nextPaths := fragment["next"]
	handoffIDs := fragment["handoff"]
	if len(tokens) != 1 || !isSafeToken(tokens[0], 43, 128) || len(nextPaths) > 1 || len(handoffIDs) > 1 {
		return false
	}
	if len(nextPaths) == 1 && nextPaths[0] != string(identityapp.PasswordlessReturnPathVaults) && nextPaths[0] != string(identityapp.PasswordlessReturnPathInvitationRedeem) {
		return false
	}
	if pwa {
		return len(handoffIDs) == 1 && isSafeToken(handoffIDs[0], 16, 128)
	}
	return len(handoffIDs) == 0
}

func renderMagicLinkMessage(from mail.Address, recipient string, link string) ([]byte, error) {
	content := renderMagicLinkEmail(link)
	return renderSMTPMessage(from, recipient, content.Subject, content.Text, content.HTML)
}

func renderSMTPMessage(from mail.Address, recipient string, subject string, text string, htmlBody string) ([]byte, error) {
	boundaryBytes := make([]byte, 16)
	if _, err := rand.Read(boundaryBytes); err != nil {
		return nil, err
	}
	boundary := "rhasia-scret-" + hex.EncodeToString(boundaryBytes)
	var message bytes.Buffer
	fmt.Fprintf(&message, "From: %s\r\n", from.String())
	fmt.Fprintf(&message, "To: %s\r\n", (&mail.Address{Address: recipient}).String())
	fmt.Fprintf(&message, "Subject: %s\r\n", mime.QEncoding.Encode("UTF-8", subject))
	message.WriteString("MIME-Version: 1.0\r\n")
	fmt.Fprintf(&message, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)
	writer := multipart.NewWriter(&message)
	if err := writer.SetBoundary(boundary); err != nil {
		return nil, err
	}
	if err := writeQuotedPrintablePart(writer, "text/plain; charset=utf-8", text); err != nil {
		return nil, err
	}
	if err := writeQuotedPrintablePart(writer, "text/html; charset=utf-8", htmlBody); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return message.Bytes(), nil
}

type magicLinkEmailContent struct {
	Subject string
	Text    string
	HTML    string
}

func renderMagicLinkEmail(link string) magicLinkEmailContent {
	const (
		subject     = "rhasia-scret sign-in link"
		title       = "Sign in to rhasia-scret"
		description = "Use the button below to sign in or create your hosted account."
		button      = "Sign in"
		fallback    = "If the button does not work, open this link:"
		ignore      = "If you did not request this link, you can ignore this email."
	)
	text := strings.Join([]string{title, description, button + ": " + link, fallback + "\n" + link, ignore}, "\n\n")
	escapedLink := html.EscapeString(link)
	const font = "Manrope, Arial, Helvetica, sans-serif"
	const (
		background   = "#f8f4ed"
		surface      = "#fffdf9"
		mutedSurface = "#f1eee9"
		border       = "#ded8d0"
		subtleBorder = "#e5e3df"
		ink          = "#273039"
		inkStrong    = "#171d22"
		gold         = "#e5a72e"
		goldStrong   = "#c88717"
		mutedText    = "#737b81"
	)
	escapedTitle := html.EscapeString(title)
	escapedDescription := html.EscapeString(description)
	escapedButton := html.EscapeString(button)
	escapedFallback := html.EscapeString(fallback)
	escapedIgnore := html.EscapeString(ignore)
	content := []string{
		fmt.Sprintf(`<h1 style="margin:0 0 12px;color:%s;font-size:24px;line-height:32px;font-weight:700;letter-spacing:-0.02em;">%s</h1>`, inkStrong, escapedTitle),
		fmt.Sprintf(`<p style="margin:0 0 24px;color:%s;font-size:16px;line-height:24px;">%s</p>`, ink, escapedDescription),
		fmt.Sprintf(`<p style="margin:0 0 24px;"><a href="%s" style="display:inline-block;padding:12px 20px;border-radius:12px;background-color:%s;color:%s;font-family:%s;font-size:16px;line-height:24px;font-weight:700;text-align:center;text-decoration:none;">%s</a></p>`, escapedLink, gold, inkStrong, font, escapedButton),
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 20px;">`,
		"  <tr>",
		fmt.Sprintf(`    <td style="padding:16px;border-left:3px solid %s;border-radius:8px;background-color:%s;">`, gold, mutedSurface),
		fmt.Sprintf(`      <p style="margin:0 0 8px;color:%s;font-family:%s;font-size:14px;line-height:20px;">%s</p>`, ink, font, escapedFallback),
		fmt.Sprintf(`      <a href="%s" style="color:%s;font-family:%s;font-size:14px;line-height:20px;overflow-wrap:anywhere;word-break:break-all;">%s</a>`, escapedLink, goldStrong, font, escapedLink),
		"    </td>",
		"  </tr>",
		"</table>",
		fmt.Sprintf(`<p style="margin:0;color:%s;font-family:%s;font-size:12px;line-height:16px;">%s</p>`, mutedText, font, escapedIgnore),
	}
	wordmark := `<span style="color:#273039;">rhasia-</span><span style="color:#e5a72e;">scret</span>`
	htmlBody := strings.Join([]string{
		"<!doctype html>",
		`<html lang="en">`,
		"<head>",
		`<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">`,
		`<meta name="viewport" content="width=device-width, initial-scale=1.0">`,
		"<title>" + html.EscapeString(subject) + "</title>",
		"</head>",
		fmt.Sprintf(`<body style="margin:0;background-color:%s;color:%s;font-family:%s;-webkit-text-size-adjust:100%%;">`, background, ink, font),
		fmt.Sprintf(`<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" border="0" style="width:100%%;background-color:%s;">`, background),
		"  <tr>",
		`    <td align="center" style="padding:24px 16px 40px;">`,
		fmt.Sprintf(`<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%%;max-width:600px;border:1px solid %s;border-top:4px solid %s;border-radius:16px;background-color:%s;box-shadow:0 1px 2px rgba(23,29,34,0.04),0 8px 24px rgba(23,29,34,0.06);">`, border, gold, surface),
		"  <tr>",
		fmt.Sprintf(`    <td align="center" style="padding:20px 32px 18px;border-bottom:1px solid %s;">`, subtleBorder),
		fmt.Sprintf(`      <div style="font-size:18px;line-height:22px;font-weight:700;letter-spacing:-0.02em;">%s</div>`, wordmark),
		"    </td>",
		"  </tr>",
		"  <tr>",
		`    <td style="padding:32px;">`,
		strings.Join(content, "\n"),
		"    </td>",
		"  </tr>",
		"  <tr>",
		fmt.Sprintf(`    <td align="center" style="padding:16px 32px 20px;border-top:1px solid %s;color:%s;">`, subtleBorder, mutedText),
		fmt.Sprintf(`      <p style="margin:0;color:%s;font-size:12px;line-height:16px;">%s <span>by</span> <a href="https://nooroctavian.id/" style="color:%s;font-weight:700;text-decoration:none;">nooroctavian.id</a></p>`, mutedText, wordmark, ink),
		"    </td>",
		"  </tr>",
		"</table>",
		"    </td>",
		"  </tr>",
		"</table>",
		"</body>",
		"</html>",
	}, "\n")
	return magicLinkEmailContent{Subject: subject, Text: text, HTML: htmlBody}
}

func writeQuotedPrintablePart(writer *multipart.Writer, contentType string, body string) error {
	part, err := writer.CreatePart(mapHeader("Content-Type", contentType, "Content-Transfer-Encoding", "quoted-printable"))
	if err != nil {
		return err
	}
	quoted := quotedprintable.NewWriter(part)
	if _, err := io.WriteString(quoted, body); err != nil {
		_ = quoted.Close()
		return err
	}
	return quoted.Close()
}

func mapHeader(key string, value string, additionalKey string, additionalValue string) map[string][]string {
	return map[string][]string{key: {value}, additionalKey: {additionalValue}}
}

var _ identity.EmailDelivery = (*SMTPEmailSender)(nil)
