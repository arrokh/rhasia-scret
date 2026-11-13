package config

import (
	"strings"
	"testing"
)

func TestReadEnvironment(t *testing.T) {
	tests := []struct {
		name                 string
		values               map[string]string
		wantErr              string
		wantPort             int
		wantDeploymentTarget string
	}{
		{name: "defaults port and reads API-only bindings", values: map[string]string{"DATABASE_URL": "postgresql://localhost/example", "DIRECT_URL": "postgresql://admin:secret@localhost/example", "DEPLOYMENT_TARGET": "selfhosted"}, wantPort: DefaultPort, wantDeploymentTarget: "selfhosted"},
		{name: "accepts explicit port", values: map[string]string{"PORT": "8788"}, wantPort: 8788},
		{name: "rejects malformed port", values: map[string]string{"PORT": "8788x"}, wantErr: "PORT"},
		{name: "rejects zero port", values: map[string]string{"PORT": "0"}, wantErr: "PORT"},
		{name: "rejects oversized port", values: map[string]string{"PORT": "65536"}, wantErr: "PORT"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			environment, err := ReadEnvironment(func(name string) (string, bool) {
				value, ok := test.values[name]
				return value, ok
			})
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("ReadEnvironment() error = %v, want substring %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("ReadEnvironment() error = %v", err)
			}
			if environment.Port != test.wantPort {
				t.Fatalf("port = %d, want %d", environment.Port, test.wantPort)
			}
			if environment.DeploymentTarget != test.wantDeploymentTarget {
				t.Fatalf("deployment target = %q, want %q", environment.DeploymentTarget, test.wantDeploymentTarget)
			}
			if strings.Contains(environment.DatabaseURL, "secret") {
				t.Fatal("DATABASE_URL unexpectedly contains the direct URL credentials")
			}
		})
	}
}

func TestRequireDatabaseURL(t *testing.T) {
	if _, err := (Environment{}).RequireDatabaseURL(); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("RequireDatabaseURL() error = %v, want DATABASE_URL error", err)
	}
	got, err := (Environment{DatabaseURL: " postgresql://localhost/example "}).RequireDatabaseURL()
	if err != nil || got != "postgresql://localhost/example" {
		t.Fatalf("RequireDatabaseURL() = %q, %v", got, err)
	}
}
