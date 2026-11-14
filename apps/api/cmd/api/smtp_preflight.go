package main

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/config"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
	apiService "github.com/nooroctavian/rhasia-scret/apps/api/internal/service"
)

func runSMTPPreflight() error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	environment, err := config.FromProcess()
	if err != nil {
		return errors.New("SMTP preflight configuration is invalid")
	}
	configuration, err := apiService.ReadSMTPConfiguration(apiService.SMTPEnvironment{
		Host:        environment.SMTPHost,
		Port:        environment.SMTPPort,
		Production:  environment.NodeEnvironment == "production",
		Secure:      environment.SMTPSecure,
		RequireTLS:  environment.SMTPRequireTLS,
		Username:    environment.SMTPUser,
		Password:    environment.SMTPPassword,
		TLSCA:       environment.SMTPTLSCA,
		FromAddress: environment.AuthEmailFrom,
		FromName:    environment.AuthEmailFromName,
	})
	if err != nil {
		return errors.New("SMTP preflight configuration is invalid")
	}
	sender, err := apiService.NewIdentitySMTPEmailSender(configuration)
	if err != nil {
		return errors.New("SMTP preflight sender is not configured")
	}
	webOrigin := strings.TrimRight(environment.WebOrigin, "/")
	if webOrigin == "" {
		webOrigin = "http://localhost:4000"
	}
	actionURL, err := url.Parse(webOrigin + "/smtp-preflight")
	if err != nil {
		return errors.New("SMTP preflight URL is invalid")
	}
	if err := sender.SendMagicLink(ctx, "smtp-preflight@loadtest.invalid", actionURL, localization.English); err != nil {
		return errors.New("SMTP preflight delivery failed")
	}
	return nil
}
