package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v5"

	membershipdomain "github.com/nooroctavian/rhasia-scret/apps/api/internal/entity/vault-membership"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/httpapi"
	membershipapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/service/vault-membership"
	sharedapp "github.com/nooroctavian/rhasia-scret/apps/api/internal/shared/application"
)

type vaultParticipantRepositoryStub struct {
	listCalls   int
	listOwner   string
	listVault   string
	listRequest sharedapp.CursorPageRequest
	page        *membershipapp.VaultParticipantPage
	listErr     error

	cancelCalls int
	cancelOwner string
	cancelVault string
	cancelID    string
	cancelled   bool
	cancelErr   error
}

func (repository *vaultParticipantRepositoryStub) ListForOwner(_ context.Context, ownerID string, vaultID string, request sharedapp.CursorPageRequest) (*membershipapp.VaultParticipantPage, error) {
	repository.listCalls++
	repository.listOwner = ownerID
	repository.listVault = vaultID
	repository.listRequest = request
	return repository.page, repository.listErr
}

func (repository *vaultParticipantRepositoryStub) CancelInvitation(_ context.Context, ownerID string, vaultID string, invitationID string) (bool, error) {
	repository.cancelCalls++
	repository.cancelOwner = ownerID
	repository.cancelVault = vaultID
	repository.cancelID = invitationID
	return repository.cancelled, repository.cancelErr
}

func TestVaultParticipantHandlersListOwnerPageAndEncodeScopedCursor(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	createdAt := time.Date(2026, time.June, 7, 8, 9, 10, 123_000_000, time.UTC)
	memberID := "synthetic-member"
	permissions := membershipdomain.SharedVaultAccountPermissions{CanAddAccounts: true}
	overrides := membershipdomain.SharedVaultAccountPermissionOverrides{CanEditAccounts: ptrPermissionBool(false)}
	effective := membershipdomain.EffectiveSharedVaultAccountPermissionsFor(membershipdomain.SharedVaultMemberRoleViewer, permissions, overrides)
	memberRevision := int64(3)
	repository := &vaultParticipantRepositoryStub{
		page: &membershipapp.VaultParticipantPage{
			Owner:                          membershipapp.VaultParticipantOwner{ID: "synthetic-owner", Email: "owner@example.test"},
			VaultDefaultAccountPermissions: permissions, VaultDefaultAccountPermissionsRevision: 5,
			Items: []membershipapp.VaultParticipant{{
				Key: "member:" + memberID, Email: "member@example.test", Kind: membershipapp.VaultParticipantKindMember,
				UserID: &memberID, InvitedAt: createdAt, PermissionOverrides: &overrides,
				EffectiveAccountPermissions: &effective, PermissionsRevision: &memberRevision,
			}},
			NextCursor: &sharedapp.TimestampCursor{CreatedAt: createdAt, Key: "member:" + memberID},
		},
	}
	handlers := NewVaultParticipantHandlers(authorizer, repository).OperationHandlers()
	request := httptest.NewRequest(http.MethodGet, "/v1/shared-vaults/synthetic-vault/participants?limit=1", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["getSharedvaultsVaultIdParticipants"](context); err != nil {
		t.Fatalf("list Vault participants: %v", err)
	}
	if response.Code != http.StatusOK || authorizer.mutation != "" || repository.listOwner != "synthetic-owner" ||
		repository.listVault != "synthetic-vault" || repository.listRequest.Limit != 1 || repository.listRequest.Cursor != nil {
		t.Fatalf("participant list response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
	var body struct {
		Owner struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"owner"`
		Participants []map[string]any `json:"participants"`
		NextCursor   string           `json:"nextCursor"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode participant page: %v", err)
	}
	if body.Owner.ID != "synthetic-owner" || body.Owner.Email != "owner@example.test" || len(body.Participants) != 1 ||
		body.Participants[0]["kind"] != "MEMBER" || body.Participants[0]["invitedAt"] != "2026-06-07T08:09:10.123Z" || body.NextCursor == "" {
		t.Fatalf("participant response fields=%#v", body)
	}
	decoded, errorCode := httpapi.ParseTimestampCursorPageRequest(
		map[string][]string{"cursor": {body.NextCursor}}, "vault-participants:synthetic-vault", func(key string) bool { return key == "member:"+memberID },
	)
	if errorCode != "" || decoded.Cursor == nil || decoded.Cursor.Key != "member:"+memberID || !decoded.Cursor.CreatedAt.Equal(createdAt) {
		t.Fatalf("returned participant cursor=%#v error=%q", decoded, errorCode)
	}
}

func TestVaultParticipantHandlersRejectBadPaginationAndMapInvitationCancellation(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: true}
	repository := &vaultParticipantRepositoryStub{cancelled: false}
	handlers := NewVaultParticipantHandlers(authorizer, repository).OperationHandlers()
	for _, target := range []string{
		"/v1/shared-vaults/synthetic-vault/participants?limit=51",
		"/v1/shared-vaults/synthetic-vault/participants?cursor=bad",
	} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		response := httptest.NewRecorder()
		context := echo.New().NewContext(request, response)
		context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
		if err := handlers["getSharedvaultsVaultIdParticipants"](context); err != nil {
			t.Fatalf("invalid participant pagination %s: %v", target, err)
		}
		if response.Code != http.StatusBadRequest || repository.listCalls != 0 {
			t.Fatalf("invalid pagination response=%d calls=%d body=%s", response.Code, repository.listCalls, response.Body.String())
		}
	}
	request := httptest.NewRequest(http.MethodDelete, "/v1/shared-vaults/synthetic-vault/share-links/synthetic-invitation", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}, {Name: "invitationId", Value: "synthetic-invitation"}})
	if err := handlers["deleteSharedvaultsVaultIdSharelinksInvitationId"](context); err != nil {
		t.Fatalf("cancel unavailable invitation: %v", err)
	}
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), "invitation_unavailable") ||
		authorizer.mutation != "membership_mutation" || repository.cancelOwner != "synthetic-owner" ||
		repository.cancelVault != "synthetic-vault" || repository.cancelID != "synthetic-invitation" {
		t.Fatalf("invitation cancellation response=%d %s auth=%#v repository=%#v", response.Code, response.Body.String(), authorizer, repository)
	}
}

func TestVaultParticipantHandlersStopOnAuthorizationAndPropagateUnexpectedErrors(t *testing.T) {
	authorizer := &sharedVaultAccessAuthorizerStub{userID: "synthetic-owner", authorized: false}
	repository := &vaultParticipantRepositoryStub{}
	handlers := NewVaultParticipantHandlers(authorizer, repository).OperationHandlers()
	request := httptest.NewRequest(http.MethodGet, "/v1/shared-vaults/synthetic-vault/participants", nil)
	response := httptest.NewRecorder()
	context := echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["getSharedvaultsVaultIdParticipants"](context); err != nil {
		t.Fatalf("unauthorized participant list: %v", err)
	}
	if response.Code != http.StatusUnauthorized || repository.listCalls != 0 {
		t.Fatalf("unauthorized participant list response=%d calls=%d", response.Code, repository.listCalls)
	}

	authorizer.authorized = true
	repository.listErr = contextCanceledError{}
	request = httptest.NewRequest(http.MethodGet, "/v1/shared-vaults/synthetic-vault/participants", nil)
	response = httptest.NewRecorder()
	context = echo.New().NewContext(request, response)
	context.SetPathValues(echo.PathValues{{Name: "vaultId", Value: "synthetic-vault"}})
	if err := handlers["getSharedvaultsVaultIdParticipants"](context); err != repository.listErr {
		t.Fatalf("participant repository error=%v; want propagation", err)
	}
	if response.Body.Len() != 0 {
		t.Fatalf("participant repository error was mapped locally: %s", response.Body.String())
	}
}

type contextCanceledError struct{}

func (contextCanceledError) Error() string { return "synthetic repository error" }

func ptrPermissionBool(value bool) *bool { return &value }
