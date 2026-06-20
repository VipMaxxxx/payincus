package report

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxReportedIncusInstances = 1000
	incusStateConcurrency     = 8
)

var externalGuestInterfacePattern = regexp.MustCompile(`^(eth[0-9]+|en(?:o|p|s|x)[a-z0-9]+)$`)

type incusAPIResponse struct {
	Type     string          `json:"type"`
	Status   string          `json:"status"`
	Error    string          `json:"error"`
	Metadata json.RawMessage `json:"metadata"`
}

type incusInstanceSummary struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	StatusCode int    `json:"status_code"`
	Type       string `json:"type"`
}

type incusInstanceState struct {
	Status  string                        `json:"status"`
	Network map[string]incusNetworkDevice `json:"network"`
}

type incusNetworkDevice struct {
	Addresses []incusNetworkAddress `json:"addresses"`
	Hwaddr    string                `json:"hwaddr"`
	Counters  incusNetworkCounters  `json:"counters"`
	State     string                `json:"state"`
}

type incusNetworkAddress struct {
	Family  string `json:"family"`
	Address string `json:"address"`
}

type incusNetworkCounters struct {
	BytesReceived json.Number `json:"bytes_received"`
	BytesSent     json.Number `json:"bytes_sent"`
}

type trafficCounters struct {
	rx uint64
	tx uint64
}

func collectIncusInstanceReport() map[string]any {
	reportedAt := time.Now().UTC().Format(time.RFC3339)
	socketPath, ok := detectIncusSocket()
	if !ok {
		return map[string]any{
			"available":  false,
			"reportedAt": reportedAt,
			"total":      0,
			"items":      []any{},
		}
	}

	// 只通过本机 Unix socket 做只读采集，不要求宿主机开放额外 Agent 端口。
	client := newIncusUnixHTTPClient(socketPath)
	instances, err := listIncusInstances(client)
	if err != nil {
		return map[string]any{
			"available":  false,
			"reportedAt": reportedAt,
			"total":      0,
			"items":      []any{},
			"error":      truncateReportError(err),
		}
	}

	limitedInstances := instances
	if len(limitedInstances) > maxReportedIncusInstances {
		limitedInstances = limitedInstances[:maxReportedIncusInstances]
	}

	items := make([]map[string]any, len(limitedInstances))
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, incusStateConcurrency)

	for index, instance := range limitedInstances {
		wg.Add(1)
		go func(index int, instance incusInstanceSummary) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			items[index] = buildIncusInstanceReportItem(client, instance)
		}(index, instance)
	}
	wg.Wait()

	normalizedItems := make([]any, 0, len(items))
	for _, item := range items {
		if item != nil {
			normalizedItems = append(normalizedItems, item)
		}
	}

	return map[string]any{
		"available":  true,
		"reportedAt": reportedAt,
		"total":      len(instances),
		"truncated":  len(instances) > len(limitedInstances),
		"items":      normalizedItems,
	}
}

func newIncusUnixHTTPClient(socketPath string) *http.Client {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _network string, _addr string) (net.Conn, error) {
			var dialer net.Dialer
			return dialer.DialContext(ctx, "unix", socketPath)
		},
		DisableCompression: true,
		DisableKeepAlives:  true,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   8 * time.Second,
	}
}

func listIncusInstances(client *http.Client) ([]incusInstanceSummary, error) {
	return incusRequest[[]incusInstanceSummary](client, "/1.0/instances?recursion=1")
}

func getIncusInstanceState(client *http.Client, name string) (incusInstanceState, error) {
	return incusRequest[incusInstanceState](client, "/1.0/instances/"+url.PathEscape(name)+"/state")
}

func incusRequest[T any](client *http.Client, path string) (T, error) {
	var zero T
	request, err := http.NewRequest(http.MethodGet, "http://incus"+path, nil)
	if err != nil {
		return zero, err
	}

	response, err := client.Do(request)
	if err != nil {
		return zero, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return zero, fmt.Errorf("incus request failed: path=%s status=%d", path, response.StatusCode)
	}

	var envelope incusAPIResponse
	decoder := json.NewDecoder(response.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&envelope); err != nil {
		return zero, err
	}
	if envelope.Type == "error" {
		if envelope.Error != "" {
			return zero, fmt.Errorf("incus error: %s", envelope.Error)
		}
		return zero, fmt.Errorf("incus error: status=%s", envelope.Status)
	}

	metadataDecoder := json.NewDecoder(bytes.NewReader(envelope.Metadata))
	metadataDecoder.UseNumber()
	if err := metadataDecoder.Decode(&zero); err != nil {
		return zero, err
	}
	return zero, nil
}

func buildIncusInstanceReportItem(client *http.Client, instance incusInstanceSummary) map[string]any {
	item := map[string]any{
		"name":       instance.Name,
		"status":     instance.Status,
		"statusCode": instance.StatusCode,
		"type":       instance.Type,
	}

	if instance.Name == "" {
		return item
	}

	state, err := getIncusInstanceState(client, instance.Name)
	if err != nil {
		item["error"] = truncateReportError(err)
		return item
	}
	if state.Status != "" {
		item["status"] = state.Status
	}

	counters := getTrafficCountersFromIncusState(instance.Name, state)
	item["traffic"] = map[string]any{
		"rxBytes": strconv.FormatUint(counters.rx, 10),
		"txBytes": strconv.FormatUint(counters.tx, 10),
	}

	if ipv4, ipv6 := firstRoutableAddresses(state.Network); ipv4 != "" || ipv6 != "" {
		network := map[string]any{}
		if ipv4 != "" {
			network["ipv4"] = ipv4
		}
		if ipv6 != "" {
			network["ipv6"] = ipv6
		}
		item["network"] = network
	}

	return item
}

func getTrafficCountersFromIncusState(instanceName string, state incusInstanceState) trafficCounters {
	billableVmMacs := generateBillableVmMacs(instanceName)
	totals := trafficCounters{}
	fallbackInterfaces := make([]incusNetworkDevice, 0)
	hasStrictBillableInterface := false

	// 与面板旧采集口径保持一致，避免 guest 内部 bridge/veth 被重复计费。
	for ifName, ifData := range state.Network {
		if isBillableNetworkInterface(ifName, ifData, billableVmMacs) {
			hasStrictBillableInterface = true
			addNetworkCounters(&totals, ifData.Counters)
			continue
		}

		if isLikelyExternalGuestInterface(ifName) {
			fallbackInterfaces = append(fallbackInterfaces, ifData)
		}
	}

	if !hasStrictBillableInterface {
		for _, ifData := range fallbackInterfaces {
			addNetworkCounters(&totals, ifData.Counters)
		}
	}

	return totals
}

func isBillableNetworkInterface(ifName string, ifData incusNetworkDevice, billableVmMacs map[string]struct{}) bool {
	if ifName == "lo" {
		return false
	}
	if ifName == "eth0" || ifName == "eth1" {
		return true
	}

	hwaddr := strings.ToLower(strings.TrimSpace(ifData.Hwaddr))
	if hwaddr == "" {
		return false
	}
	_, ok := billableVmMacs[hwaddr]
	return ok
}

func isLikelyExternalGuestInterface(ifName string) bool {
	return externalGuestInterfacePattern.MatchString(strings.ToLower(ifName))
}

func addNetworkCounters(totals *trafficCounters, counters incusNetworkCounters) {
	totals.rx += jsonNumberToUint64(counters.BytesReceived)
	totals.tx += jsonNumberToUint64(counters.BytesSent)
}

func jsonNumberToUint64(value json.Number) uint64 {
	raw := strings.TrimSpace(value.String())
	if raw == "" {
		return 0
	}
	parsed, err := strconv.ParseUint(raw, 10, 64)
	if err == nil {
		return parsed
	}
	return 0
}

func generateBillableVmMacs(seed string) map[string]struct{} {
	return map[string]struct{}{
		generateVmNicMac(seed, "eth0"): {},
		generateVmNicMac(seed, "eth1"): {},
	}
}

func generateVmNicMac(seed string, nicLabel string) string {
	hash := sha256.Sum256([]byte("incudal-vm-nic:" + seed + ":" + nicLabel))
	bytes := []byte{0x02, hash[0], hash[1], hash[2], hash[3], hash[4]}
	encoded := hex.EncodeToString(bytes)
	return strings.Join([]string{
		encoded[0:2],
		encoded[2:4],
		encoded[4:6],
		encoded[6:8],
		encoded[8:10],
		encoded[10:12],
	}, ":")
}

func firstRoutableAddresses(network map[string]incusNetworkDevice) (string, string) {
	var ipv4 string
	var ipv6 string

	for _, ifData := range network {
		for _, address := range ifData.Addresses {
			if address.Address == "" {
				continue
			}
			ip := net.ParseIP(address.Address)
			if ip == nil || !isRoutableGuestIP(ip) {
				continue
			}
			if ipv4 == "" && ip.To4() != nil && strings.EqualFold(address.Family, "inet") {
				ipv4 = address.Address
				continue
			}
			if ipv6 == "" && ip.To4() == nil && strings.EqualFold(address.Family, "inet6") {
				ipv6 = address.Address
			}
		}
	}

	return ipv4, ipv6
}

func isRoutableGuestIP(ip net.IP) bool {
	return !ip.IsLoopback() &&
		!ip.IsUnspecified() &&
		!ip.IsLinkLocalUnicast() &&
		!ip.IsLinkLocalMulticast() &&
		!ip.IsMulticast()
}

func truncateReportError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 200 {
		return message[:200]
	}
	return message
}
