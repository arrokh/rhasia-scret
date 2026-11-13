package localization

type Locale string

const (
	Indonesian Locale = "id"
	English    Locale = "en"
	CookieName        = "RHSIA_LOCALE"
)

func ResolveLocale(value string) Locale {
	if Locale(value) == English {
		return English
	}
	return Indonesian
}
