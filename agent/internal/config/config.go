package config

import (
	"bufio"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultHeartbeatIntervalSeconds = 30
	MinHeartbeatIntervalSeconds     = 5
	MaxHeartbeatIntervalSeconds     = 3600
)

type Config struct {
	PanelURL                 string
	AgentID                  string
	AgentSecret              string
	HeartbeatInterval        time.Duration
	RequestTimeout           time.Duration
	HeartbeatIntervalSeconds int
	RequestTimeoutSeconds    int
}

func Load(path string) (Config, error) {
	values := map[string]string{}
	if path != "" {
		fileValues, err := readKeyValueFile(path)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return Config{}, err
		}
		for key, value := range fileValues {
			values[key] = value
		}
	}

	overlayEnv(values, "panel_url", "INCUDAL_PANEL_URL")
	overlayEnv(values, "agent_id", "INCUDAL_AGENT_ID")
	overlayEnv(values, "agent_secret", "INCUDAL_AGENT_SECRET")
	overlayEnv(values, "heartbeat_interval_seconds", "INCUDAL_HEARTBEAT_INTERVAL_SECONDS")
	overlayEnv(values, "request_timeout_seconds", "INCUDAL_REQUEST_TIMEOUT_SECONDS")

	heartbeatSeconds := clampInt(
		parsePositiveInt(values["heartbeat_interval_seconds"], DefaultHeartbeatIntervalSeconds),
		MinHeartbeatIntervalSeconds,
		MaxHeartbeatIntervalSeconds,
	)
	timeoutSeconds := parsePositiveInt(values["request_timeout_seconds"], 10)
	cfg := Config{
		PanelURL:                 strings.TrimRight(values["panel_url"], "/"),
		AgentID:                  values["agent_id"],
		AgentSecret:              values["agent_secret"],
		HeartbeatIntervalSeconds: heartbeatSeconds,
		RequestTimeoutSeconds:    timeoutSeconds,
		HeartbeatInterval:        time.Duration(heartbeatSeconds) * time.Second,
		RequestTimeout:           time.Duration(timeoutSeconds) * time.Second,
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (cfg Config) Validate() error {
	if cfg.PanelURL == "" {
		return errors.New("panel_url is required")
	}
	parsed, err := url.Parse(cfg.PanelURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("panel_url is invalid: %s", cfg.PanelURL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("panel_url scheme must be http or https: %s", parsed.Scheme)
	}
	if cfg.AgentID == "" {
		return errors.New("agent_id is required")
	}
	if cfg.AgentSecret == "" {
		return errors.New("agent_secret is required")
	}
	if cfg.HeartbeatInterval < time.Duration(MinHeartbeatIntervalSeconds)*time.Second {
		return fmt.Errorf("heartbeat interval must be at least %d seconds", MinHeartbeatIntervalSeconds)
	}
	if cfg.RequestTimeout < time.Second {
		return errors.New("request timeout must be at least 1 second")
	}
	return nil
}

func readKeyValueFile(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	values := map[string]string{}
	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			return nil, fmt.Errorf("invalid config line %d: expected key: value", lineNumber)
		}
		key = strings.TrimSpace(key)
		value = trimConfigValue(value)
		if key == "" {
			return nil, fmt.Errorf("invalid config line %d: empty key", lineNumber)
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return values, nil
}

func trimConfigValue(value string) string {
	trimmed := strings.TrimSpace(value)
	trimmed = strings.Trim(trimmed, `"`)
	trimmed = strings.Trim(trimmed, `'`)
	return trimmed
}

func overlayEnv(values map[string]string, key string, envName string) {
	if value := strings.TrimSpace(os.Getenv(envName)); value != "" {
		values[key] = value
	}
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func clampInt(value int, min int, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
