package report

import (
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var incusSocketCandidates = []string{
	"/var/lib/incus/unix.socket",
	"/var/snap/incus/common/lxd/unix.socket",
	"/var/lib/lxd/unix.socket",
}

func HeartbeatPayload(version string, heartbeatIntervalSeconds int) map[string]any {
	return map[string]any{
		"version":      version,
		"capabilities": []any{"heartbeat", "report", "host-metrics", "instance-status", "traffic-counters"},
		"runtime": map[string]any{
			"goos":   runtime.GOOS,
			"goarch": runtime.GOARCH,
		},
		"incus":     detectIncus(),
		"instances": collectIncusInstanceReport(),
		"resources": collectResources(),
		"metrics":   collectMetrics(heartbeatIntervalSeconds),
	}
}

func collectResources() map[string]any {
	resources := map[string]any{
		"cpuTotal": runtime.NumCPU(),
	}
	if cpuUsagePercent := readCPUUsagePercent(); cpuUsagePercent >= 0 {
		resources["cpuUsagePercent"] = cpuUsagePercent
	}
	for key, value := range readMemoryStats() {
		resources[key] = value
	}
	for key, value := range readDiskStats("/") {
		resources[key] = value
	}
	if processCount := readProcessCount(); processCount >= 0 {
		resources["processCount"] = processCount
	}
	return resources
}

func collectMetrics(heartbeatIntervalSeconds int) map[string]any {
	switch {
	case heartbeatIntervalSeconds <= 0:
		heartbeatIntervalSeconds = 30
	case heartbeatIntervalSeconds < 5:
		heartbeatIntervalSeconds = 5
	case heartbeatIntervalSeconds > 3600:
		heartbeatIntervalSeconds = 3600
	}

	metrics := map[string]any{
		"reportedAt":               time.Now().UTC().Format(time.RFC3339),
		"heartbeatIntervalSeconds": heartbeatIntervalSeconds,
	}
	if uptimeSeconds := readUptimeSeconds(); uptimeSeconds > 0 {
		metrics["uptimeSeconds"] = uptimeSeconds
	}
	for key, value := range readLoadAverage() {
		metrics[key] = value
	}
	return metrics
}

func detectIncus() map[string]any {
	socketPath, ok := detectIncusSocket()
	if ok {
		return map[string]any{
			"available": true,
			"socket":    socketPath,
		}
	}
	return map[string]any{
		"available": false,
		"socket":    "",
	}
}

func detectIncusSocket() (string, bool) {
	for _, socketPath := range incusSocketCandidates {
		if info, err := os.Stat(socketPath); err == nil && !info.IsDir() {
			return socketPath, true
		}
	}
	return "", false
}

type cpuStat struct {
	idle  uint64
	total uint64
}

func readCPUUsagePercent() float64 {
	before, ok := readCPUStat()
	if !ok {
		return -1
	}
	time.Sleep(200 * time.Millisecond)
	after, ok := readCPUStat()
	if !ok {
		return -1
	}

	totalDelta := after.total - before.total
	idleDelta := after.idle - before.idle
	if totalDelta == 0 || idleDelta > totalDelta {
		return -1
	}

	return roundPercent(float64(totalDelta-idleDelta) / float64(totalDelta) * 100)
}

func readCPUStat() (cpuStat, bool) {
	content, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuStat{}, false
	}
	for _, line := range strings.Split(string(content), "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 5 {
			return cpuStat{}, false
		}

		var values []uint64
		for _, field := range fields[1:] {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				return cpuStat{}, false
			}
			values = append(values, value)
		}

		var total uint64
		for _, value := range values {
			total += value
		}
		idle := values[3]
		if len(values) > 4 {
			idle += values[4]
		}
		return cpuStat{idle: idle, total: total}, true
	}
	return cpuStat{}, false
}

func readMemoryStats() map[string]any {
	meminfo := readMeminfoKB()
	stats := map[string]any{}
	memTotal := meminfo["MemTotal"]
	memAvailable := meminfo["MemAvailable"]
	if memTotal > 0 {
		memUsed := memTotal - memAvailable
		if memUsed < 0 {
			memUsed = 0
		}
		stats["memoryTotalMb"] = memTotal / 1024
		stats["memoryAvailableMb"] = memAvailable / 1024
		stats["memoryUsedMb"] = memUsed / 1024
		stats["memoryUsagePercent"] = roundPercent(float64(memUsed) / float64(memTotal) * 100)
	}

	swapTotal := meminfo["SwapTotal"]
	swapFree := meminfo["SwapFree"]
	if swapTotal > 0 {
		swapUsed := swapTotal - swapFree
		if swapUsed < 0 {
			swapUsed = 0
		}
		stats["swapTotalMb"] = swapTotal / 1024
		stats["swapUsedMb"] = swapUsed / 1024
		stats["swapUsagePercent"] = roundPercent(float64(swapUsed) / float64(swapTotal) * 100)
	} else {
		stats["swapTotalMb"] = int64(0)
		stats["swapUsedMb"] = int64(0)
		stats["swapUsagePercent"] = float64(0)
	}

	return stats
}

func readMeminfoKB() map[string]int64 {
	content, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return map[string]int64{}
	}

	values := map[string]int64{}
	for _, line := range strings.Split(string(content), "\n") {
		key, rest, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		kb, err := strconv.ParseInt(fields[0], 10, 64)
		if err != nil {
			continue
		}
		values[key] = kb
	}
	return values
}

func readDiskStats(path string) map[string]any {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return map[string]any{}
	}

	blockSize := uint64(stat.Bsize)
	total := stat.Blocks * blockSize
	free := stat.Bfree * blockSize
	if total == 0 || free > total {
		return map[string]any{}
	}

	used := total - free
	return map[string]any{
		"diskMountpoint":     path,
		"diskTotalBytes":     total,
		"diskUsedBytes":      used,
		"diskAvailableBytes": stat.Bavail * blockSize,
		"diskUsagePercent":   roundPercent(float64(used) / float64(total) * 100),
	}
}

func readLoadAverage() map[string]any {
	content, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return map[string]any{}
	}
	fields := strings.Fields(string(content))
	if len(fields) < 3 {
		return map[string]any{}
	}

	loads := map[string]any{}
	keys := []string{"load1", "load5", "load15"}
	for index, key := range keys {
		value, err := strconv.ParseFloat(fields[index], 64)
		if err == nil {
			loads[key] = value
		}
	}
	return loads
}

func readProcessCount() int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return -1
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if _, err := strconv.Atoi(entry.Name()); err == nil {
			count++
		}
	}
	return count
}

func readUptimeSeconds() int64 {
	content, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(content))
	if len(fields) == 0 {
		return 0
	}
	value, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return int64(value)
}

func roundPercent(value float64) float64 {
	return float64(int(value*10+0.5)) / 10
}
