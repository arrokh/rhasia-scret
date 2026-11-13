package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
)

func TestRequestLocaleUsesOnlyValidatedLocaleCookie(t *testing.T) {
	for _, test := range []struct {
		name       string
		cookie     string
		accept     string
		wantLocale localization.Locale
	}{
		{name: "missing cookie defaults to Indonesian", wantLocale: localization.Indonesian},
		{name: "Indonesian cookie", cookie: "id", wantLocale: localization.Indonesian},
		{name: "English cookie", cookie: "en", wantLocale: localization.English},
		{name: "unsupported cookie defaults to Indonesian", cookie: "fr", wantLocale: localization.Indonesian},
		{name: "accept language is ignored", accept: "en-US", wantLocale: localization.Indonesian},
		{name: "malformed cookie defaults to Indonesian", cookie: "en; Secure", wantLocale: localization.Indonesian},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "https://api.example.test/v1/health", nil)
			if test.cookie != "" {
				request.AddCookie(&http.Cookie{Name: localization.CookieName, Value: test.cookie})
			}
			if test.accept != "" {
				request.Header.Set("Accept-Language", test.accept)
			}
			if got := RequestLocale(request); got != test.wantLocale {
				t.Fatalf("RequestLocale() = %q; want %q", got, test.wantLocale)
			}
		})
	}
}
