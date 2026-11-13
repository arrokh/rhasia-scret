package httpapi

import (
	"github.com/labstack/echo/v5"
)

type compatibilityJSONSerializer struct {
	delegate echo.JSONSerializer
}

func (serializer compatibilityJSONSerializer) Serialize(ctx *echo.Context, target any, indent string) error {
	if ctx.Response().Header().Get(echo.HeaderContentType) == echo.MIMEApplicationJSON {
		ctx.Response().Header().Set(echo.HeaderContentType, echo.MIMEApplicationJSONCharsetUTF8)
	}
	return serializer.delegate.Serialize(ctx, target, indent)
}

func (serializer compatibilityJSONSerializer) Deserialize(ctx *echo.Context, target any) error {
	return serializer.delegate.Deserialize(ctx, target)
}
