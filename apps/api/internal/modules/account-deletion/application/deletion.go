package application

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"time"
)

const (
	DeletionConfirmation          = "HAPUS AKUN"
	DeletionAuthorizationLifetime = 10 * time.Minute
)

var (
	ErrInvalidDeletionRequest          = errors.New("account deletion request is invalid")
	ErrInvalidDeletionConfirmation     = errors.New("account deletion confirmation is invalid")
	ErrDeletionAcknowledgementRequired = errors.New("account deletion acknowledgement is required")
	ErrInvalidDeletionVaultDecisions   = errors.New("account deletion vault decisions are invalid")
	ErrInvalidDeletionTransferTarget   = errors.New("account deletion transfer target is invalid")
	ErrDeletionAuthorization           = errors.New("account deletion authorization is unavailable")
	ErrDeletionPlanStale               = errors.New("account deletion plan is stale")
)

var (
	deletionOpaqueIdentifier   = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
	deletionAuthorizationToken = regexp.MustCompile(`^[A-Za-z0-9_-]{43,128}$`)
)

func ValidDeletionAuthorizationToken(token string) bool {
	return deletionAuthorizationToken.MatchString(token)
}

func ValidDeletionOpaqueIdentifier(value string) bool {
	return deletionOpaqueIdentifier.MatchString(value)
}

type VaultAction string

const (
	VaultActionDelete   VaultAction = "DELETE"
	VaultActionTransfer VaultAction = "TRANSFER"
)

type OptionalString struct {
	Value   string
	Present bool
}

func (optional *OptionalString) UnmarshalJSON(raw []byte) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return errors.New("optional string must be a non-null string when present")
	}
	var value string
	if err := json.Unmarshal(trimmed, &value); err != nil {
		return err
	}
	optional.Value = value
	optional.Present = true
	return nil
}

type VaultDecision struct {
	VaultID          string         `json:"vaultId"`
	Action           VaultAction    `json:"action"`
	TransferToUserID OptionalString `json:"transferToUserId,omitempty"`
}

type DeletionRequest struct {
	Confirmation   string          `json:"confirmation"`
	Acknowledged   bool            `json:"acknowledged"`
	VaultDecisions []VaultDecision `json:"vaultDecisions"`
}

func ValidateDeletionRequest(request DeletionRequest) error {
	if request.Confirmation != DeletionConfirmation {
		return ErrInvalidDeletionConfirmation
	}
	if !request.Acknowledged {
		return ErrDeletionAcknowledgementRequired
	}
	if request.VaultDecisions == nil || len(request.VaultDecisions) > 128 {
		return ErrInvalidDeletionVaultDecisions
	}
	seenVaults := make(map[string]struct{}, len(request.VaultDecisions))
	for _, decision := range request.VaultDecisions {
		if !deletionOpaqueIdentifier.MatchString(decision.VaultID) {
			return ErrInvalidDeletionVaultDecisions
		}
		if _, exists := seenVaults[decision.VaultID]; exists {
			return ErrInvalidDeletionVaultDecisions
		}
		seenVaults[decision.VaultID] = struct{}{}
		switch decision.Action {
		case VaultActionDelete:
			if decision.TransferToUserID.Present {
				return ErrInvalidDeletionVaultDecisions
			}
		case VaultActionTransfer:
			if !decision.TransferToUserID.Present || !deletionOpaqueIdentifier.MatchString(decision.TransferToUserID.Value) {
				return ErrInvalidDeletionTransferTarget
			}
		case "":
			return ErrInvalidDeletionVaultDecisions
		default:
			return ErrInvalidDeletionVaultDecisions
		}
	}
	return nil
}

type DeletionResult struct {
	ReceiptID                   string
	Email                       string
	EmailDelivery               string
	PersonalVaultCount          int
	SharedVaultDeletedCount     int
	SharedVaultTransferredCount int
	AuthenticatorAccountCount   int
}

type DeletionRepository interface {
	FindCompletedDeletion(context.Context, string) (*DeletionResult, error)
	DeleteUser(context.Context, string, string, DeletionRequest, time.Time) (DeletionResult, error)
	RecordCompletionEmailStatus(context.Context, string, string) error
}

type CompletionEmailSender interface {
	SendDeletionCompletion(context.Context, string, string) error
}
