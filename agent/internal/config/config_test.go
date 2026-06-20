package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadClampsHeartbeatInterval(t *testing.T) {
	tests := []struct {
		name     string
		value    string
		expected int
	}{
		{name: "too low", value: "1", expected: MinHeartbeatIntervalSeconds},
		{name: "too high", value: "7200", expected: MaxHeartbeatIntervalSeconds},
		{name: "valid", value: "60", expected: 60},
		{name: "invalid", value: "invalid", expected: DefaultHeartbeatIntervalSeconds},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			configPath := writeTestConfig(t, tt.value)
			cfg, err := Load(configPath)
			if err != nil {
				t.Fatalf("load config: %v", err)
			}
			if cfg.HeartbeatIntervalSeconds != tt.expected {
				t.Fatalf("heartbeat seconds mismatch: got=%d want=%d", cfg.HeartbeatIntervalSeconds, tt.expected)
			}
			if cfg.HeartbeatInterval != time.Duration(tt.expected)*time.Second {
				t.Fatalf("heartbeat interval mismatch: got=%s want=%s", cfg.HeartbeatInterval, time.Duration(tt.expected)*time.Second)
			}
		})
	}
}

func writeTestConfig(t *testing.T, heartbeatInterval string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "config.yaml")
	content := "panel_url: \"https://panel.example\"\n" +
		"agent_id: \"agt_test\"\n" +
		"agent_secret: \"ias_test\"\n" +
		"heartbeat_interval_seconds: " + heartbeatInterval + "\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}
