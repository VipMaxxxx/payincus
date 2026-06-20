package upgrade

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"incudal-agent/internal/config"
	"incudal-agent/internal/panel"
)

const (
	defaultServiceName      = "incudal-agent"
	defaultMaxDownloadBytes = 64 * 1024 * 1024
)

var ErrUpgradeInProgress = errors.New("agent upgrade already in progress")
var systemdServiceNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.@-]+$`)

type RestartFunc func(ctx context.Context, serviceName string) error

type Runner struct {
	BinaryPath       string
	BackupPath       string
	LockPath         string
	ServiceName      string
	AllowedBaseURL   string
	HTTPClient       *http.Client
	Restart          RestartFunc
	MaxDownloadBytes int64
}

func DefaultRunner(cfg config.Config) *Runner {
	binaryPath, err := os.Executable()
	if err != nil || binaryPath == "" {
		binaryPath = "/usr/local/bin/incudal-agent"
	}

	return &Runner{
		BinaryPath:       binaryPath,
		BackupPath:       binaryPath + ".bak",
		LockPath:         defaultLockPath(),
		ServiceName:      defaultServiceName,
		AllowedBaseURL:   cfg.PanelURL,
		HTTPClient:       &http.Client{Timeout: cfg.RequestTimeout},
		Restart:          restartSystemdService,
		MaxDownloadBytes: defaultMaxDownloadBytes,
	}
}

func RandomJitter(max time.Duration) time.Duration {
	if max <= 0 {
		return 0
	}
	limit := big.NewInt(int64(max))
	value, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return 0
	}
	return time.Duration(value.Int64())
}

func (runner *Runner) Apply(ctx context.Context, instruction panel.UpgradeInstruction, currentVersion string) error {
	if !instruction.Available {
		return nil
	}
	if instruction.Version == "" {
		return errors.New("upgrade version is required")
	}
	if instruction.Version == currentVersion {
		return nil
	}
	if instruction.URL == "" {
		return errors.New("upgrade URL is required")
	}
	if instruction.SHA256 == "" {
		return errors.New("upgrade sha256 is required")
	}
	if err := runner.validateUpgradeURL(instruction.URL); err != nil {
		return err
	}

	unlock, err := acquireLock(runner.lockPath())
	if err != nil {
		return err
	}
	defer unlock()

	packageBytes, err := runner.download(ctx, instruction.URL)
	if err != nil {
		return err
	}
	if err := verifySHA256(packageBytes, instruction.SHA256); err != nil {
		return err
	}

	binaryBytes := packageBytes
	if instruction.Gzip {
		binaryBytes, err = gunzip(packageBytes)
		if err != nil {
			return err
		}
	}

	tempPath, err := runner.writeTempBinary(binaryBytes)
	if err != nil {
		return err
	}
	if err := runner.replaceBinary(tempPath); err != nil {
		_ = os.Remove(tempPath)
		return err
	}

	if err := runner.restart(ctx); err != nil {
		return fmt.Errorf("restart agent after upgrade: %w", err)
	}
	return nil
}

func (runner *Runner) validateUpgradeURL(rawURL string) error {
	upgradeURL, err := url.Parse(rawURL)
	if err != nil || upgradeURL.Scheme == "" || upgradeURL.Host == "" {
		return fmt.Errorf("upgrade URL is invalid: %s", rawURL)
	}
	if upgradeURL.Scheme != "http" && upgradeURL.Scheme != "https" {
		return fmt.Errorf("upgrade URL scheme is not allowed: %s", upgradeURL.Scheme)
	}

	baseURL, err := url.Parse(strings.TrimRight(runner.AllowedBaseURL, "/"))
	if err != nil || baseURL.Scheme == "" || baseURL.Host == "" {
		return fmt.Errorf("panel URL is invalid: %s", runner.AllowedBaseURL)
	}
	if !strings.EqualFold(upgradeURL.Scheme, baseURL.Scheme) || !strings.EqualFold(upgradeURL.Host, baseURL.Host) {
		return errors.New("upgrade URL is outside panel origin")
	}
	return nil
}

func (runner *Runner) download(ctx context.Context, rawURL string) ([]byte, error) {
	client := runner.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("download upgrade failed: status=%d body=%s", response.StatusCode, string(body))
	}

	limit := runner.MaxDownloadBytes
	if limit <= 0 {
		limit = defaultMaxDownloadBytes
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("upgrade package exceeds %d bytes", limit)
	}
	return body, nil
}

func (runner *Runner) writeTempBinary(binaryBytes []byte) (string, error) {
	binaryPath := runner.binaryPath()
	tempFile, err := os.CreateTemp(filepath.Dir(binaryPath), ".incudal-agent-upgrade-*")
	if err != nil {
		return "", err
	}
	tempPath := tempFile.Name()
	defer tempFile.Close()

	if _, err := tempFile.Write(binaryBytes); err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	if err := tempFile.Chmod(0755); err != nil {
		_ = os.Remove(tempPath)
		return "", err
	}
	return tempPath, nil
}

func (runner *Runner) replaceBinary(tempPath string) error {
	binaryPath := runner.binaryPath()
	backupPath := runner.backupPath()

	if _, err := os.Stat(binaryPath); err == nil {
		_ = os.Remove(backupPath)
		if err := copyFile(binaryPath, backupPath); err != nil {
			return fmt.Errorf("backup current agent: %w", err)
		}
	}

	if err := os.Rename(tempPath, binaryPath); err != nil {
		return fmt.Errorf("replace agent binary: %w", err)
	}
	return nil
}

func (runner *Runner) rollback() error {
	backupPath := runner.backupPath()
	if _, err := os.Stat(backupPath); err != nil {
		return err
	}
	return os.Rename(backupPath, runner.binaryPath())
}

func (runner *Runner) restart(ctx context.Context) error {
	if runner.Restart == nil {
		return nil
	}
	serviceName := runner.ServiceName
	if serviceName == "" {
		serviceName = defaultServiceName
	}
	return runner.Restart(ctx, serviceName)
}

func (runner *Runner) binaryPath() string {
	if runner.BinaryPath != "" {
		return runner.BinaryPath
	}
	return "/usr/local/bin/incudal-agent"
}

func (runner *Runner) backupPath() string {
	if runner.BackupPath != "" {
		return runner.BackupPath
	}
	return runner.binaryPath() + ".bak"
}

func (runner *Runner) lockPath() string {
	if runner.LockPath != "" {
		return runner.LockPath
	}
	return defaultLockPath()
}

func defaultLockPath() string {
	if info, err := os.Stat("/run"); err == nil && info.IsDir() {
		return "/run/incudal-agent-upgrade.lock"
	}
	return filepath.Join(os.TempDir(), "incudal-agent-upgrade.lock")
}

func acquireLock(lockPath string) (func(), error) {
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, ErrUpgradeInProgress
		}
		return nil, err
	}
	_, _ = fmt.Fprintf(file, "%d\n", os.Getpid())
	_ = file.Close()

	return func() {
		_ = os.Remove(lockPath)
	}, nil
}

func verifySHA256(payload []byte, expected string) error {
	sum := sha256.Sum256(payload)
	actual := hex.EncodeToString(sum[:])
	if !strings.EqualFold(actual, expected) {
		return fmt.Errorf("upgrade sha256 mismatch: expected=%s actual=%s", expected, actual)
	}
	return nil
}

func gunzip(payload []byte) ([]byte, error) {
	reader, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(reader)
}

func copyFile(source string, target string) error {
	sourceFile, err := os.Open(source)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	info, err := sourceFile.Stat()
	if err != nil {
		return err
	}
	mode := info.Mode().Perm()
	if mode == 0 {
		mode = 0755
	}

	targetFile, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer targetFile.Close()

	if _, err := io.Copy(targetFile, sourceFile); err != nil {
		return err
	}
	return targetFile.Chmod(mode)
}

func restartSystemdService(ctx context.Context, serviceName string) error {
	if !systemdServiceNamePattern.MatchString(serviceName) {
		return fmt.Errorf("invalid systemd service name: %s", serviceName)
	}

	if err := scheduleSystemdRestart(ctx, serviceName); err == nil {
		return nil
	}

	systemctlPath, err := exec.LookPath("systemctl")
	if err != nil {
		return err
	}

	// 不等待 systemctl 完成。Agent 正在重启自身，等待子进程会在服务停止时
	// 收到 SIGTERM，旧逻辑会误判失败并回滚已替换的新二进制。
	command := exec.CommandContext(ctx, systemctlPath, "restart", serviceName)
	return command.Start()
}

func scheduleSystemdRestart(ctx context.Context, serviceName string) error {
	systemdRunPath, err := exec.LookPath("systemd-run")
	if err != nil {
		return err
	}
	systemctlPath, err := exec.LookPath("systemctl")
	if err != nil {
		return err
	}

	unitName := fmt.Sprintf("incudal-agent-restart-%d", os.Getpid())
	args := []string{
		"--unit", unitName,
		"--description", "Restart Incudal Agent after self-upgrade",
		"--on-active=2s",
		"--collect",
		systemctlPath, "restart", serviceName,
	}

	command := exec.CommandContext(ctx, systemdRunPath, args...)
	output, err := command.CombinedOutput()
	if err == nil {
		return nil
	}

	// 老版本 systemd 可能不支持 --collect，降级重试一次。
	if strings.Contains(string(output), "unrecognized option '--collect'") ||
		strings.Contains(string(output), "Unknown option --collect") {
		args = []string{
			"--unit", unitName,
			"--description", "Restart Incudal Agent after self-upgrade",
			"--on-active=2s",
			systemctlPath, "restart", serviceName,
		}
		command = exec.CommandContext(ctx, systemdRunPath, args...)
		output, err = command.CombinedOutput()
	}
	if err != nil {
		trimmedOutput := strings.TrimSpace(string(output))
		if trimmedOutput == "" {
			return err
		}
		return fmt.Errorf("%w: %s", err, trimmedOutput)
	}
	return nil
}
