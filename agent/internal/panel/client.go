package panel

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"incudal-agent/internal/config"
	"incudal-agent/internal/protocol"
)

const heartbeatPath = "/api/agent/heartbeat"

type Client struct {
	panelURL    string
	agentID     string
	agentSecret string
	httpClient  *http.Client
}

type HeartbeatResult struct {
	StatusCode int
	Body       string
	OK         bool
	Upgrade    *UpgradeInstruction
	LatencyMs  int64
}

type UpgradeInstruction struct {
	Available bool   `json:"available"`
	Version   string `json:"version"`
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	Gzip      bool   `json:"gzip"`
	Size      int64  `json:"size"`
}

type heartbeatResponse struct {
	Upgrade *UpgradeInstruction `json:"upgrade"`
}

func New(cfg config.Config) *Client {
	return &Client{
		panelURL:    strings.TrimRight(cfg.PanelURL, "/"),
		agentID:     cfg.AgentID,
		agentSecret: cfg.AgentSecret,
		httpClient: &http.Client{
			Timeout: cfg.RequestTimeout,
		},
	}
}

func (client *Client) Heartbeat(ctx context.Context, payload map[string]any) (HeartbeatResult, error) {
	body, err := protocol.CanonicalJSON(payload)
	if err != nil {
		return HeartbeatResult{}, err
	}

	timestamp := protocol.NewTimestamp()
	nonce, err := protocol.NewNonce()
	if err != nil {
		return HeartbeatResult{}, err
	}
	bodyHash := protocol.BodySHA256(body)
	signingPayload := protocol.SigningPayload(http.MethodPost, heartbeatPath, timestamp, nonce, bodyHash)
	signature := protocol.Signature(client.agentSecret, signingPayload)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, client.panelURL+heartbeatPath, bytes.NewReader(body))
	if err != nil {
		return HeartbeatResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-incudal-agent-id", client.agentID)
	request.Header.Set("x-incudal-timestamp", timestamp)
	request.Header.Set("x-incudal-nonce", nonce)
	request.Header.Set("x-incudal-body-sha256", bodyHash)
	request.Header.Set("x-incudal-signature", signature)

	startedAt := time.Now()
	response, err := client.httpClient.Do(request)
	if err != nil {
		return HeartbeatResult{}, err
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024))
	if err != nil {
		return HeartbeatResult{}, err
	}

	result := HeartbeatResult{
		StatusCode: response.StatusCode,
		Body:       string(responseBody),
		OK:         response.StatusCode >= 200 && response.StatusCode < 300,
		LatencyMs:  time.Since(startedAt).Milliseconds(),
	}
	if !result.OK {
		return result, fmt.Errorf("heartbeat failed: status=%d body=%s", response.StatusCode, result.Body)
	}

	var parsedResponse heartbeatResponse
	if err := json.Unmarshal(responseBody, &parsedResponse); err == nil {
		result.Upgrade = parsedResponse.Upgrade
	}

	var parsed map[string]any
	if err := json.Unmarshal(responseBody, &parsed); err == nil {
		parsed["latencyMs"] = result.LatencyMs
		if compact, err := json.Marshal(parsed); err == nil {
			result.Body = string(compact)
		}
	}
	return result, nil
}
