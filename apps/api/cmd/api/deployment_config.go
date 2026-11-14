package main

import (
	"errors"
	"strings"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/app/api"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/config"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
)

func verifyDeploymentConfiguration(lookup config.LookupEnv) error {
	if lookup == nil {
		return errors.New("environment lookup is required")
	}
	environment, err := config.ReadEnvironment(lookup)
	if err != nil {
		return errors.New("API deployment configuration is invalid")
	}
	production := environment.NodeEnvironment == "production"
	if value, _ := lookup("VERIFY_DEPLOYMENT_PRODUCTION"); value == "1" {
		production = true
	}
	var failures []string
	if production {
		if err := config.ValidateProductionDeployment(environment); err != nil {
			failures = append(failures, err.Error())
		}
	}
	if strings.TrimSpace(environment.DatabaseURL) != "" {
		if _, err := postgres.ParseRuntimePoolConfig(environment.DatabaseURL); err != nil {
			failures = append(failures, "DATABASE_URL must be a valid PostgreSQL runtime URL.")
		}
	}
	if production {
		backend, _ := lookup("AUTH_BACKEND")
		switch strings.TrimSpace(backend) {
		case "":
			failures = append(failures, "AUTH_BACKEND must be set explicitly in production.")
		case "none":
			if strings.TrimSpace(environment.DeploymentTarget) != "selfhosted" {
				failures = append(failures, "AUTH_BACKEND=none is allowed only for the self-hosted production target.")
			}
		}
	}
	validationEnvironment := environment
	if production {
		validationEnvironment.NodeEnvironment = "production"
	}
	if err := servercomposition.ValidateEnvironment(validationEnvironment); err != nil {
		failures = append(failures, "authentication or SMTP configuration is invalid.")
	}
	if len(failures) != 0 {
		return errors.New(strings.Join(failures, " "))
	}
	return nil
}
