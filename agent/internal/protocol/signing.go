package protocol

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// CanonicalJSON 使用 Go 标准库的 JSON 编码。
// map key 会按字典序输出，必须与面板端 stableStringify 规则保持一致。
func CanonicalJSON(value any) ([]byte, error) {
	return json.Marshal(value)
}

func BodySHA256(body []byte) string {
	sum := sha256.Sum256(body)
	return hex.EncodeToString(sum[:])
}

func SigningPayload(method string, path string, timestamp string, nonce string, bodyHash string) string {
	return strings.Join([]string{
		strings.ToUpper(method),
		path,
		timestamp,
		nonce,
		strings.ToLower(bodyHash),
	}, "\n")
}

func Signature(secret string, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func NewTimestamp() string {
	return fmt.Sprintf("%d", time.Now().UnixMilli())
}

func NewNonce() (string, error) {
	var raw [18]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}
