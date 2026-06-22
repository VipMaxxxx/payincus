package protocol

import "testing"

func TestCanonicalJSONIsStableForMapOrder(t *testing.T) {
	bodyA := map[string]any{
		"version": "0.1.0",
		"resources": map[string]any{
			"memory": 1024,
			"cpu":    8,
		},
		"capabilities": []any{"heartbeat", "report"},
	}
	bodyB := map[string]any{
		"capabilities": []any{"heartbeat", "report"},
		"resources": map[string]any{
			"cpu":    8,
			"memory": 1024,
		},
		"version": "0.1.0",
	}

	jsonA, err := CanonicalJSON(bodyA)
	if err != nil {
		t.Fatalf("canonical json A: %v", err)
	}
	jsonB, err := CanonicalJSON(bodyB)
	if err != nil {
		t.Fatalf("canonical json B: %v", err)
	}

	if string(jsonA) != string(jsonB) {
		t.Fatalf("canonical json mismatch:\nA=%s\nB=%s", jsonA, jsonB)
	}
	if BodySHA256(jsonA) != BodySHA256(jsonB) {
		t.Fatalf("body hash mismatch")
	}
}

func TestCanonicalJSONMatchesPanelStableStringifyEscaping(t *testing.T) {
	body := map[string]any{
		"metrics": map[string]any{
			"label": "<tag>&value",
			"load1": 1.23,
		},
	}

	jsonBody, err := CanonicalJSON(body)
	if err != nil {
		t.Fatalf("canonical json: %v", err)
	}

	const expected = `{"metrics":{"label":"<tag>&value","load1":1.23}}`
	if string(jsonBody) != expected {
		t.Fatalf("canonical json mismatch:\ngot=%s\nwant=%s", jsonBody, expected)
	}
}

func TestSignatureChangesWithPath(t *testing.T) {
	secret := "ias_test_secret"
	bodyHash := BodySHA256([]byte(`{"ok":true}`))
	payloadA := SigningPayload("POST", "/api/agent/heartbeat", "1777380000000", "nonce-123456", bodyHash)
	payloadB := SigningPayload("POST", "/api/agent/report", "1777380000000", "nonce-123456", bodyHash)

	if Signature(secret, payloadA) == Signature(secret, payloadB) {
		t.Fatalf("signature should change when request path changes")
	}
}
