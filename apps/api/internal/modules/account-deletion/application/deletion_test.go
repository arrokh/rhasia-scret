package application

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestValidateDeletionRequestRequiresExplicitConfirmationAcknowledgementAndVaultChoices(t *testing.T) {
	valid := DeletionRequest{Confirmation: DeletionConfirmation, Acknowledged: true, VaultDecisions: []VaultDecision{}}
	if err := ValidateDeletionRequest(valid); err != nil {
		t.Fatalf("valid empty-vault deletion request rejected: %v", err)
	}
	for _, test := range []struct {
		name    string
		request DeletionRequest
		want    error
	}{
		{name: "incorrect phrase", request: DeletionRequest{Confirmation: "DELETE ACCOUNT", Acknowledged: true, VaultDecisions: []VaultDecision{}}, want: ErrInvalidDeletionConfirmation},
		{name: "missing acknowledgement", request: DeletionRequest{Confirmation: DeletionConfirmation, VaultDecisions: []VaultDecision{}}, want: ErrDeletionAcknowledgementRequired},
		{name: "missing decision array", request: DeletionRequest{Confirmation: DeletionConfirmation, Acknowledged: true}, want: ErrInvalidDeletionVaultDecisions},
		{name: "malformed vault ID", request: DeletionRequest{Confirmation: DeletionConfirmation, Acknowledged: true, VaultDecisions: []VaultDecision{{VaultID: "short", Action: VaultActionDelete}}}, want: ErrInvalidDeletionVaultDecisions},
		{name: "duplicate vault ID", request: DeletionRequest{Confirmation: DeletionConfirmation, Acknowledged: true, VaultDecisions: []VaultDecision{{VaultID: "synthetic-vault-0001", Action: VaultActionDelete}, {VaultID: "synthetic-vault-0001", Action: VaultActionDelete}}}, want: ErrInvalidDeletionVaultDecisions},
		{name: "delete with transfer target", request: DeletionRequest{Confirmation: DeletionConfirmation, Acknowledged: true, VaultDecisions: []VaultDecision{{VaultID: "synthetic-vault-0001", Action: VaultActionDelete, TransferToUserID: OptionalString{Value: "synthetic-user-00001", Present: true}}}}, want: ErrInvalidDeletionVaultDecisions},
		{name: "transfer missing target", request: DeletionRequest{Confirmation: DeletionConfirmation, Acknowledged: true, VaultDecisions: []VaultDecision{{VaultID: "synthetic-vault-0001", Action: VaultActionTransfer}}}, want: ErrInvalidDeletionTransferTarget},
		{name: "transfer malformed target", request: DeletionRequest{Confirmation: DeletionConfirmation, Acknowledged: true, VaultDecisions: []VaultDecision{{VaultID: "synthetic-vault-0001", Action: VaultActionTransfer, TransferToUserID: OptionalString{Value: "short", Present: true}}}}, want: ErrInvalidDeletionTransferTarget},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := ValidateDeletionRequest(test.request); !errors.Is(err, test.want) {
				t.Fatalf("validation error=%v; want %v", err, test.want)
			}
		})
	}
}

func TestVaultDecisionOptionalTransferTargetRejectsNullAndTracksPresence(t *testing.T) {
	var absent VaultDecision
	if err := json.Unmarshal([]byte(`{"vaultId":"synthetic-vault-0001","action":"DELETE"}`), &absent); err != nil {
		t.Fatalf("decode decision without transfer target: %v", err)
	}
	if absent.TransferToUserID.Present {
		t.Fatal("omitted transfer target was marked present")
	}
	for _, raw := range []string{
		`{"vaultId":"synthetic-vault-0001","action":"TRANSFER","transferToUserId":null}`,
		`{"vaultId":"synthetic-vault-0001","action":"TRANSFER","transferToUserId":1}`,
	} {
		var decision VaultDecision
		if err := json.Unmarshal([]byte(raw), &decision); err == nil {
			t.Fatalf("accepted invalid optional transfer target %s", raw)
		}
	}
}
