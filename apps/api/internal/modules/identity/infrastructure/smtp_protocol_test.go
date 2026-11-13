package infrastructure

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

type smtpProtocolCapture struct {
	commandsBeforeTLS []string
	authPayload       []byte
	mailFrom          string
	recipients        []string
	message           []byte
	tlsVersion        uint16
	err               error
}

type smtpProtocolServer struct {
	listener net.Listener
	cert     tls.Certificate
	capture  chan smtpProtocolCapture
}

func startSMTPProtocolServer(t *testing.T) (*smtpProtocolServer, string, []byte) {
	t.Helper()
	certificate, certificatePEM := newSMTPTestCertificate(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for local synthetic SMTP server: %v", err)
	}
	server := &smtpProtocolServer{listener: listener, cert: certificate, capture: make(chan smtpProtocolCapture, 1)}
	t.Cleanup(func() { _ = listener.Close() })
	go server.serve()
	return server, strconv.Itoa(listener.Addr().(*net.TCPAddr).Port), certificatePEM
}

func newSMTPTestCertificate(t *testing.T) (tls.Certificate, []byte) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate synthetic SMTP key: %v", err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatalf("create synthetic SMTP certificate: %v", err)
	}
	certificatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})
	certificate, err := tls.X509KeyPair(certificatePEM, privateKeyPEM)
	if err != nil {
		t.Fatalf("load synthetic SMTP certificate: %v", err)
	}
	return certificate, certificatePEM
}

func (server *smtpProtocolServer) serve() {
	capture := smtpProtocolCapture{}
	defer func() { server.capture <- capture }()
	connection, err := server.listener.Accept()
	if err != nil {
		capture.err = err
		return
	}
	defer connection.Close()
	_ = connection.SetDeadline(time.Now().Add(10 * time.Second))
	reader := bufio.NewReader(connection)
	writer := bufio.NewWriter(connection)
	if err := smtpWriteLine(writer, "220 smtp.example.test ESMTP synthetic test server"); err != nil {
		capture.err = err
		return
	}
	command, err := smtpReadCommand(reader)
	if err != nil {
		capture.err = err
		return
	}
	capture.commandsBeforeTLS = append(capture.commandsBeforeTLS, command)
	if !strings.HasPrefix(strings.ToUpper(command), "EHLO ") {
		capture.err = fmt.Errorf("expected EHLO, received %q", command)
		return
	}
	if err := smtpWriteCapabilities(writer, true); err != nil {
		capture.err = err
		return
	}
	command, err = smtpReadCommand(reader)
	if err != nil {
		capture.err = err
		return
	}
	capture.commandsBeforeTLS = append(capture.commandsBeforeTLS, command)
	if strings.ToUpper(command) != "STARTTLS" {
		capture.err = fmt.Errorf("expected STARTTLS before credentials, received %q", command)
		return
	}
	if err := smtpWriteLine(writer, "220 ready to start TLS"); err != nil {
		capture.err = err
		return
	}
	tlsConnection := tls.Server(connection, &tls.Config{Certificates: []tls.Certificate{server.cert}, MinVersion: tls.VersionTLS12})
	if err := tlsConnection.Handshake(); err != nil {
		capture.err = fmt.Errorf("synthetic SMTP TLS handshake: %w", err)
		return
	}
	capture.tlsVersion = tlsConnection.ConnectionState().Version
	reader = bufio.NewReader(tlsConnection)
	writer = bufio.NewWriter(tlsConnection)
	command, err = smtpReadCommand(reader)
	if err != nil {
		capture.err = err
		return
	}
	if !strings.HasPrefix(strings.ToUpper(command), "EHLO ") {
		capture.err = fmt.Errorf("expected post-TLS EHLO, received %q", command)
		return
	}
	if err := smtpWriteCapabilities(writer, false); err != nil {
		capture.err = err
		return
	}
	for {
		command, err = smtpReadCommand(reader)
		if err != nil {
			capture.err = err
			return
		}
		switch {
		case strings.HasPrefix(strings.ToUpper(command), "AUTH PLAIN "):
			encoded := strings.TrimSpace(command[len("AUTH PLAIN "):])
			capture.authPayload, err = base64.StdEncoding.DecodeString(encoded)
			if err != nil {
				capture.err = fmt.Errorf("decode synthetic SMTP auth: %w", err)
				return
			}
			if err := smtpWriteLine(writer, "235 2.7.0 authentication successful"); err != nil {
				capture.err = err
				return
			}
		case strings.HasPrefix(strings.ToUpper(command), "MAIL FROM:"):
			capture.mailFrom = command[len("MAIL FROM:"):]
			if err := smtpWriteLine(writer, "250 2.1.0 sender accepted"); err != nil {
				capture.err = err
				return
			}
		case strings.HasPrefix(strings.ToUpper(command), "RCPT TO:"):
			capture.recipients = append(capture.recipients, command[len("RCPT TO:"):])
			if err := smtpWriteLine(writer, "250 2.1.5 recipient accepted"); err != nil {
				capture.err = err
				return
			}
		case strings.EqualFold(command, "DATA"):
			if err := smtpWriteLine(writer, "354 end with <CRLF>.<CRLF>"); err != nil {
				capture.err = err
				return
			}
			for {
				line, readErr := reader.ReadString('\n')
				if readErr != nil {
					capture.err = readErr
					return
				}
				if line == ".\r\n" {
					break
				}
				if strings.HasPrefix(line, "..") {
					line = line[1:]
				}
				capture.message = append(capture.message, line...)
			}
			if err := smtpWriteLine(writer, "250 2.0.0 message accepted"); err != nil {
				capture.err = err
				return
			}
		case strings.EqualFold(command, "QUIT"):
			if err := smtpWriteLine(writer, "221 2.0.0 closing connection"); err != nil {
				capture.err = err
			}
			return
		default:
			capture.err = fmt.Errorf("unexpected synthetic SMTP command %q", command)
			return
		}
	}
}

func smtpReadCommand(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(strings.TrimSuffix(line, "\n"), "\r"), nil
}

func smtpWriteLine(writer *bufio.Writer, line string) error {
	if _, err := writer.WriteString(line + "\r\n"); err != nil {
		return err
	}
	return writer.Flush()
}

func smtpWriteCapabilities(writer *bufio.Writer, advertiseStartTLS bool) error {
	if _, err := writer.WriteString("250-localhost\r\n"); err != nil {
		return err
	}
	if advertiseStartTLS {
		if _, err := writer.WriteString("250-STARTTLS\r\n"); err != nil {
			return err
		}
	}
	if _, err := writer.WriteString("250 AUTH PLAIN\r\n"); err != nil {
		return err
	}
	return writer.Flush()
}

func TestSMTPEmailSenderAuthenticatesOnlyAfterVerifiedStartTLS(t *testing.T) {
	server, port, certificatePEM := startSMTPProtocolServer(t)
	portNumber, err := strconv.Atoi(port)
	if err != nil {
		t.Fatalf("parse synthetic SMTP server port: %v", err)
	}
	// Use the test server's ephemeral port; configuration validation separately enforces production SMTP ports.
	sender := &SMTPEmailSender{configuration: SMTPConfiguration{
		Host:       "127.0.0.1",
		Port:       portNumber,
		RequireTLS: true,
		Username:   "smtp-user",
		Password:   "smtp-password",
		TLSCA:      certificatePEM,
		From:       mail.Address{Name: "rhasia-scret", Address: "no-reply@example.test"},
	}}
	link, err := url.Parse("https://auth.example.test/auth/confirm#token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&next=%2Fvaults")
	if err != nil {
		t.Fatalf("parse synthetic sign-in link: %v", err)
	}
	if err := sender.SendMagicLink(context.Background(), "person@example.test", link); err != nil {
		t.Fatalf("deliver synthetic magic-link email: %v", err)
	}

	var capture smtpProtocolCapture
	select {
	case capture = <-server.capture:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for synthetic SMTP server capture")
	}
	if capture.err != nil {
		t.Fatalf("synthetic SMTP server: %v", capture.err)
	}
	if capture.tlsVersion < tls.VersionTLS12 {
		t.Fatalf("SMTP TLS version = %d; want TLS 1.2 or newer", capture.tlsVersion)
	}
	if len(capture.commandsBeforeTLS) != 2 || strings.ToUpper(capture.commandsBeforeTLS[1]) != "STARTTLS" {
		t.Fatalf("SMTP commands before TLS = %#v; want only EHLO and STARTTLS", capture.commandsBeforeTLS)
	}
	if string(capture.authPayload) != "\x00smtp-user\x00smtp-password" {
		t.Fatalf("SMTP authentication was not received inside TLS: %q", capture.authPayload)
	}
	if !strings.Contains(capture.mailFrom, "no-reply@example.test") || len(capture.recipients) != 1 || !strings.Contains(capture.recipients[0], "person@example.test") {
		t.Fatalf("unexpected SMTP envelope: from=%q recipients=%#v", capture.mailFrom, capture.recipients)
	}

	message, err := mail.ReadMessage(bytes.NewReader(capture.message))
	if err != nil {
		t.Fatalf("parse delivered synthetic email: %v", err)
	}
	if message.Header.Get("To") != "<person@example.test>" || !strings.Contains(message.Header.Get("Subject"), "sign-in link") {
		t.Fatalf("unexpected synthetic email headers: %#v", message.Header)
	}
	mediaType, parameters, err := mime.ParseMediaType(message.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/alternative" {
		t.Fatalf("email Content-Type = %q, %v; want multipart/alternative", mediaType, err)
	}
	parts := multipart.NewReader(message.Body, parameters["boundary"])
	var plainBody, htmlBody string
	for {
		part, nextErr := parts.NextPart()
		if nextErr == io.EOF {
			break
		}
		if nextErr != nil {
			t.Fatalf("read synthetic email part: %v", nextErr)
		}
		body, readErr := io.ReadAll(part)
		if readErr != nil {
			t.Fatalf("read synthetic email body: %v", readErr)
		}
		switch {
		case strings.HasPrefix(part.Header.Get("Content-Type"), "text/plain"):
			plainBody = string(body)
		case strings.HasPrefix(part.Header.Get("Content-Type"), "text/html"):
			htmlBody = string(body)
		}
	}
	if !strings.Contains(plainBody, "Sign in to rhasia-scret") || !strings.Contains(plainBody, link.String()) {
		t.Error("plain email body is incomplete or changed the action URL")
	}
	escapedFragment := strings.ReplaceAll(link.String(), "&", "&amp;")
	if !strings.Contains(htmlBody, "Sign in to rhasia-scret") || !strings.Contains(htmlBody, escapedFragment) {
		t.Error("HTML email body is incomplete or did not escape the action URL")
	}
}
