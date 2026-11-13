package buildinfo

import (
	"os"
	"runtime/debug"
	"strings"
)

// Version is kept aligned with the root product version by verify-version-alignment.mjs.
var Version = "0.3.2"

// Commit may be set with -ldflags in Docker builds; Vercel also exposes its source SHA.
var Commit = "unknown"

func CommitSHA() string {
	if value := strings.TrimSpace(Commit); value != "" && value != "unknown" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("VERCEL_GIT_COMMIT_SHA")); value != "" {
		return value
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, setting := range info.Settings {
		if setting.Key == "vcs.revision" && strings.TrimSpace(setting.Value) != "" {
			return setting.Value
		}
	}
	return "unknown"
}
