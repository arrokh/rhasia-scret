package postgres

import (
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func NewCUID() (string, error) {
	var randomValue [10]byte
	if _, err := rand.Read(randomValue[:]); err != nil {
		clear(randomValue[:])
		return "", fmt.Errorf("generate application identifier: %w", err)
	}
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 36)
	if len(timestamp) > 8 {
		timestamp = timestamp[len(timestamp)-8:]
	}
	encodedRandom := strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(randomValue[:]))
	clear(randomValue[:])
	return "c" + strings.Repeat("0", 8-len(timestamp)) + timestamp + encodedRandom, nil
}
