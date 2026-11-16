package httpapi

import (
	"net/http"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/localization"
)

func RequestLocale(request *http.Request) localization.Locale {
	cookie, err := request.Cookie(localization.CookieName)
	if err != nil {
		return localization.Indonesian
	}
	return localization.ResolveLocale(cookie.Value)
}
