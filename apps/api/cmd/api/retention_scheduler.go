package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
)

const (
	defaultRetentionPurgeURL = "http://api:8787/v1/internal/retention-purge"
	retentionPurgeTimeout    = 10 * time.Second
)

type retentionSchedulerConfig struct {
	URL    *url.URL
	Secret string
}

func readRetentionSchedulerConfig(lookup func(string) (string, bool)) (retentionSchedulerConfig, error) {
	secret, _ := lookup("CRON_SECRET")
	if len(utf16.Encode([]rune(secret))) < 32 {
		return retentionSchedulerConfig{}, errors.New("retention scheduler secret is not configured")
	}
	target, _ := lookup("RETENTION_PURGE_URL")
	if strings.TrimSpace(target) == "" {
		target = defaultRetentionPurgeURL
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.Path != "/v1/internal/retention-purge" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return retentionSchedulerConfig{}, errors.New("retention scheduler URL is invalid")
	}
	return retentionSchedulerConfig{URL: parsed, Secret: secret}, nil
}

func runRetentionScheduler(ctx context.Context) error {
	configuration, err := readRetentionSchedulerConfig(os.LookupEnv)
	if err != nil {
		return err
	}
	logger := httpapi.NewJSONEventLogger()
	client := &http.Client{Timeout: retentionPurgeTimeout}
	nextRun := nextRetentionPurgeAt(time.Now())
	logger.Log("info", "retention_scheduler_started", map[string]any{"nextRunAt": nextRun.Format(time.RFC3339)})
	for {
		delay := time.Until(nextRun)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return nil
		case <-timer.C:
		}
		requestContext, cancel := context.WithTimeout(ctx, retentionPurgeTimeout)
		status, requestErr := requestRetentionPurge(requestContext, client, configuration.URL, configuration.Secret)
		cancel()
		if requestErr != nil {
			fields := map[string]any{}
			if status != 0 {
				fields["httpStatus"] = status
			}
			logger.Log("error", "retention_scheduler_request_failed", fields)
		} else {
			logger.Log("info", "retention_scheduler_request_completed", map[string]any{"httpStatus": status})
		}
		nextRun = nextRetentionPurgeAt(time.Now())
	}
}

func nextRetentionPurgeAt(now time.Time) time.Time {
	utc := now.UTC()
	next := time.Date(utc.Year(), utc.Month(), utc.Day(), 3, 0, 0, 0, time.UTC)
	if !next.After(utc) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

func requestRetentionPurge(ctx context.Context, client *http.Client, target *url.URL, secret string) (int, error) {
	if client == nil || target == nil {
		return 0, errors.New("retention scheduler dependencies are unavailable")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return 0, errors.New("retention purge request could not be created")
	}
	request.Header.Set("Authorization", "Bearer "+secret)
	response, err := client.Do(request)
	if err != nil {
		return 0, errors.New("retention purge request failed before receiving a response")
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return response.StatusCode, errors.New("retention purge request returned an unsuccessful status")
	}
	return response.StatusCode, nil
}

func runHealthcheck(port int) error {
	if port < 1 || port > 65_535 {
		return errors.New("healthcheck port is invalid")
	}
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/v1/health")
	if err != nil {
		return errors.New("API healthcheck request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return errors.New("API healthcheck returned an unsuccessful status")
	}
	return nil
}
