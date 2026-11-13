package main

import (
	"bytes"
	"testing"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/buildinfo"
)

func TestWriteVersionPrintsOneLine(t *testing.T) {
	t.Parallel()

	var output bytes.Buffer
	if err := writeVersion(&output); err != nil {
		t.Fatalf("write version: %v", err)
	}

	want := "rhasia-scret-api " + buildinfo.Version + " " + buildinfo.CommitSHA() + "\n"
	if got := output.String(); got != want {
		t.Fatalf("version output = %q, want %q", got, want)
	}
}
