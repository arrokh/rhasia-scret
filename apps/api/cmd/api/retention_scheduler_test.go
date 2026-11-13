package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestReadRetentionSchedulerConfigRequiresSecretAndExactPurgeEndpoint(t *testing.T) {
	t.Parallel()

	valid := map[string]string{"CRON_SECRET": strings.Repeat("x", 32)}
	lookup := func(values map[string]string) func(string) (string, bool) {
		return func(key string) (string, bool) {
			value, ok := values[key]
			return value, ok
		}
	}

	configuration, err := readRetentionSchedulerConfig(lookup(valid))
	if err != nil {
		t.Fatalf("read default configuration: %v", err)
	}
	if configuration.URL.String() != defaultRetentionPurgeURL {
		t.Fatalf("default URL = %q; want %q", configuration.URL, defaultRetentionPurgeURL)
	}

	for name, values := range map[string]map[string]string{
		"missing secret": {},
		"short secret":   {"CRON_SECRET": strings.Repeat("x", 31)},
		"wrong path":     {"CRON_SECRET": strings.Repeat("x", 32), "RETENTION_PURGE_URL": "http://api:8787/v1/health"},
		"query":          {"CRON_SECRET": strings.Repeat("x", 32), "RETENTION_PURGE_URL": defaultRetentionPurgeURL + "?token=synthetic"},
		"credentials":    {"CRON_SECRET": strings.Repeat("x", 32), "RETENTION_PURGE_URL": "http://user:pass@api:8787/v1/internal/retention-purge"},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := readRetentionSchedulerConfig(lookup(values)); err == nil {
				t.Fatal("readRetentionSchedulerConfig() succeeded for invalid configuration")
			}
		})
	}
}

func TestNextRetentionPurgeAtUsesNextThreeAMUTC(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name string
		now  time.Time
		want time.Time
	}{
		{
			name: "before run",
			now:  time.Date(2026, time.January, 2, 2, 59, 59, 0, time.UTC),
			want: time.Date(2026, time.January, 2, 3, 0, 0, 0, time.UTC),
		},
		{
			name: "at run time",
			now:  time.Date(2026, time.January, 2, 3, 0, 0, 0, time.UTC),
			want: time.Date(2026, time.January, 3, 3, 0, 0, 0, time.UTC),
		},
		{
			name: "after run",
			now:  time.Date(2026, time.January, 2, 7, 0, 0, 0, time.FixedZone("synthetic", 3*60*60)),
			want: time.Date(2026, time.January, 3, 3, 0, 0, 0, time.UTC),
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := nextRetentionPurgeAt(testCase.now); !got.Equal(testCase.want) {
				t.Fatalf("nextRetentionPurgeAt() = %s; want %s", got, testCase.want)
			}
		})
	}
}

func TestRequestRetentionPurgeUsesGETAndRedactsFailures(t *testing.T) {
	t.Parallel()

	secret := strings.Repeat("x", 37)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			t.Errorf("method = %s; want GET", request.Method)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer "+secret {
			t.Errorf("authorization header did not match the configured synthetic secret")
		}
		writer.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	parsed, err := url.Parse(server.URL + "/v1/internal/retention-purge")
	if err != nil {
		t.Fatalf("parse test URL: %v", err)
	}

	status, err := requestRetentionPurge(context.Background(), server.Client(), parsed, secret)
	if status != http.StatusUnauthorized {
		t.Fatalf("status = %d; want %d", status, http.StatusUnauthorized)
	}
	if err == nil || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), server.URL) {
		t.Fatalf("request error must be present and redacted; got %q", err)
	}
}

func TestRequestRetentionPurgeAcceptsSuccess(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	parsed, err := url.Parse(server.URL + "/v1/internal/retention-purge")
	if err != nil {
		t.Fatalf("parse test URL: %v", err)
	}
	status, err := requestRetentionPurge(context.Background(), server.Client(), parsed, strings.Repeat("x", 32))
	if err != nil || status != http.StatusNoContent {
		t.Fatalf("requestRetentionPurge() = (%d, %v); want (%d, nil)", status, err, http.StatusNoContent)
	}
}
