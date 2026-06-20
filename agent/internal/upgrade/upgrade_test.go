package upgrade

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"incudal-agent/internal/panel"
)

func TestApplyUpgradeReplacesBinaryAndRestarts(t *testing.T) {
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "incudal-agent")
	if err := os.WriteFile(binaryPath, []byte("old-binary"), 0755); err != nil {
		t.Fatalf("write current binary: %v", err)
	}

	nextBinary := []byte("new-binary")
	packageBytes := gzipBytes(t, nextBinary)
	sha := sha256Hex(packageBytes)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write(packageBytes)
	}))
	defer server.Close()

	restarted := false
	runner := Runner{
		BinaryPath:       binaryPath,
		BackupPath:       binaryPath + ".bak",
		LockPath:         filepath.Join(tempDir, "upgrade.lock"),
		ServiceName:      "incudal-agent",
		AllowedBaseURL:   server.URL,
		HTTPClient:       server.Client(),
		MaxDownloadBytes: 1024 * 1024,
		Restart: func(_ context.Context, serviceName string) error {
			if serviceName != "incudal-agent" {
				t.Fatalf("unexpected service name: %s", serviceName)
			}
			restarted = true
			return nil
		},
	}

	err := runner.Apply(context.Background(), panel.UpgradeInstruction{
		Available: true,
		Version:   "v2",
		URL:       server.URL + "/incudal-agent-linux-amd64.gz",
		SHA256:    sha,
		Gzip:      true,
	}, "v1")
	if err != nil {
		t.Fatalf("apply upgrade: %v", err)
	}
	if !restarted {
		t.Fatalf("restart was not called")
	}

	actual, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatalf("read replaced binary: %v", err)
	}
	if string(actual) != string(nextBinary) {
		t.Fatalf("binary mismatch: %q", string(actual))
	}

	backup, err := os.ReadFile(binaryPath + ".bak")
	if err != nil {
		t.Fatalf("read backup binary: %v", err)
	}
	if string(backup) != "old-binary" {
		t.Fatalf("backup mismatch: %q", string(backup))
	}
}

func TestApplyUpgradeRejectsBadSHA(t *testing.T) {
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "incudal-agent")
	if err := os.WriteFile(binaryPath, []byte("old-binary"), 0755); err != nil {
		t.Fatalf("write current binary: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write([]byte("payload"))
	}))
	defer server.Close()

	restarted := false
	runner := Runner{
		BinaryPath:       binaryPath,
		BackupPath:       binaryPath + ".bak",
		LockPath:         filepath.Join(tempDir, "upgrade.lock"),
		AllowedBaseURL:   server.URL,
		HTTPClient:       server.Client(),
		MaxDownloadBytes: 1024 * 1024,
		Restart: func(context.Context, string) error {
			restarted = true
			return nil
		},
	}

	err := runner.Apply(context.Background(), panel.UpgradeInstruction{
		Available: true,
		Version:   "v2",
		URL:       server.URL + "/incudal-agent-linux-amd64.gz",
		SHA256:    "0000000000000000000000000000000000000000000000000000000000000000",
		Gzip:      true,
	}, "v1")
	if err == nil {
		t.Fatalf("expected sha mismatch")
	}
	if restarted {
		t.Fatalf("restart should not be called")
	}

	current, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatalf("read current binary: %v", err)
	}
	if string(current) != "old-binary" {
		t.Fatalf("current binary should stay unchanged: %q", string(current))
	}
}

func TestApplyUpgradeDoesNotRollbackWhenSelfRestartIsInterrupted(t *testing.T) {
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "incudal-agent")
	if err := os.WriteFile(binaryPath, []byte("old-binary"), 0755); err != nil {
		t.Fatalf("write current binary: %v", err)
	}

	nextBinary := []byte("new-binary")
	packageBytes := gzipBytes(t, nextBinary)
	sha := sha256Hex(packageBytes)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write(packageBytes)
	}))
	defer server.Close()

	runner := Runner{
		BinaryPath:       binaryPath,
		BackupPath:       binaryPath + ".bak",
		LockPath:         filepath.Join(tempDir, "upgrade.lock"),
		ServiceName:      "incudal-agent",
		AllowedBaseURL:   server.URL,
		HTTPClient:       server.Client(),
		MaxDownloadBytes: 1024 * 1024,
		Restart: func(context.Context, string) error {
			return errors.New("signal: terminated")
		},
	}

	err := runner.Apply(context.Background(), panel.UpgradeInstruction{
		Available: true,
		Version:   "v2",
		URL:       server.URL + "/incudal-agent-linux-amd64.gz",
		SHA256:    sha,
		Gzip:      true,
	}, "v1")
	if err == nil {
		t.Fatalf("expected restart error")
	}

	actual, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatalf("read replaced binary: %v", err)
	}
	if string(actual) != string(nextBinary) {
		t.Fatalf("binary should stay replaced after restart interruption: %q", string(actual))
	}
}

func TestApplyUpgradeRejectsDifferentOrigin(t *testing.T) {
	tempDir := t.TempDir()
	binaryPath := filepath.Join(tempDir, "incudal-agent")
	if err := os.WriteFile(binaryPath, []byte("old-binary"), 0755); err != nil {
		t.Fatalf("write current binary: %v", err)
	}

	runner := Runner{
		BinaryPath:     binaryPath,
		BackupPath:     binaryPath + ".bak",
		LockPath:       filepath.Join(tempDir, "upgrade.lock"),
		AllowedBaseURL: "https://panel.example",
		Restart: func(context.Context, string) error {
			t.Fatalf("restart should not be called")
			return nil
		},
	}

	err := runner.Apply(context.Background(), panel.UpgradeInstruction{
		Available: true,
		Version:   "v2",
		URL:       "https://evil.example/incudal-agent-linux-amd64.gz",
		SHA256:    "0000000000000000000000000000000000000000000000000000000000000000",
		Gzip:      true,
	}, "v1")
	if err == nil {
		t.Fatalf("expected origin validation error")
	}
}

func gzipBytes(t *testing.T, payload []byte) []byte {
	t.Helper()

	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	if _, err := writer.Write(payload); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	return buffer.Bytes()
}

func sha256Hex(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
