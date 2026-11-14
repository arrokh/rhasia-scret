package handler

import (
	"reflect"
	"sort"
	"testing"
)

func TestAccountDeletionHandlersRegisterEveryOpenAPIOperation(t *testing.T) {
	handlers := NewAccountDeletionHandlers(nil, nil, nil, nil, nil, nil, "passwordless", previewWebOrigin, nil).OperationHandlers()
	got := make([]string, 0, len(handlers))
	for operationID := range handlers {
		got = append(got, operationID)
	}
	sort.Strings(got)
	want := []string{
		"deleteMe",
		"getMeDeletionPreview",
		"postMeDeletionOtpRequest",
		"postMeDeletionOtpVerify",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("account deletion operation IDs=%v; want %v", got, want)
	}
}
