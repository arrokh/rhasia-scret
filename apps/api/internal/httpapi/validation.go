package httpapi

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"reflect"
	"strconv"
	"unicode/utf16"
	"unicode/utf8"
)

const (
	MaxJSONBodyBytes          int64 = 256 * 1024
	MaxRotationRequestBytes   int64 = 16 * 1024 * 1024
	MaxArchiveImportBodyBytes int64 = 8 * 1024 * 1024
	MaxEncryptedBlobBytes           = 16*1024 + 29
	MaxRotationAccounts             = 500
	MaxRotationMemberPackages       = 500
	MaxRouteParameterLength         = 128
)

var (
	jsonUnmarshalerType = reflect.TypeOf((*json.Unmarshaler)(nil)).Elem()
	ErrInvalidJSONBody  = errors.New("invalid JSON request body")
	ErrJSONBodyTooLarge = errors.New("JSON request body exceeds limit")
	ErrInvalidBase64    = errors.New("invalid base64 value")
)

func DecodeJSONBody[T any](request *http.Request, maximumBytes int64) (T, error) {
	var result T
	if maximumBytes <= 0 || maximumBytes == math.MaxInt64 {
		return result, ErrInvalidJSONBody
	}
	if request.ContentLength > maximumBytes {
		return result, ErrJSONBodyTooLarge
	}
	if request.Body == nil {
		return result, ErrInvalidJSONBody
	}

	body, err := io.ReadAll(io.LimitReader(request.Body, maximumBytes+1))
	if err != nil {
		return result, ErrInvalidJSONBody
	}
	defer clear(body)
	if int64(len(body)) > maximumBytes {
		return result, ErrJSONBodyTooLarge
	}
	trimmedBody := bytes.TrimSpace(body)
	if !utf8.Valid(body) || len(trimmedBody) == 0 || bytes.Equal(trimmedBody, []byte("null")) {
		return result, ErrInvalidJSONBody
	}
	var untyped any
	if err := json.Unmarshal(body, &untyped); err != nil || validateExactJSONFields(untyped, reflect.TypeOf(result)) != nil {
		return result, ErrInvalidJSONBody
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil {
		return result, ErrInvalidJSONBody
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return result, ErrInvalidJSONBody
	}
	return result, nil
}

const MaxSafeJavaScriptInteger int64 = 1<<53 - 1

type PositiveSafeInteger int64

func (value *PositiveSafeInteger) UnmarshalJSON(raw []byte) error {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return ErrInvalidJSONBody
	}
	number, err := strconv.ParseFloat(string(trimmed), 64)
	if err != nil || math.Trunc(number) != number || number < 1 || number > float64(MaxSafeJavaScriptInteger) {
		return ErrInvalidJSONBody
	}
	*value = PositiveSafeInteger(int64(number))
	return nil
}

func ValidStringLength(value string, minimum int, maximum int) bool {
	if minimum < 0 || maximum < minimum || !utf8.ValidString(value) {
		return false
	}
	length := len(utf16.Encode([]rune(value)))
	return length >= minimum && length <= maximum
}

func ValidRouteParameter(value string) bool {
	if !ValidStringLength(value, 1, MaxRouteParameterLength) {
		return false
	}
	for _, character := range value {
		if isJavaScriptWhitespace(character) {
			return false
		}
	}
	return true
}

func isJavaScriptWhitespace(value rune) bool {
	switch value {
	case '\u0009', '\u000a', '\u000b', '\u000c', '\u000d', '\u0020', '\u00a0', '\u1680', '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff':
		return true
	}
	return value >= '\u2000' && value <= '\u200a'
}

func validateExactJSONFields(value any, target reflect.Type) error {
	for target != nil && target.Kind() == reflect.Pointer {
		target = target.Elem()
	}
	if target == nil || target.Kind() == reflect.Interface || target.Implements(jsonUnmarshalerType) || reflect.PointerTo(target).Implements(jsonUnmarshalerType) {
		return nil
	}

	switch decoded := value.(type) {
	case map[string]any:
		switch target.Kind() {
		case reflect.Struct:
			fields := jsonStructFields(target)
			for name, nested := range decoded {
				fieldType, ok := fields[name]
				if !ok {
					return ErrInvalidJSONBody
				}
				if err := validateExactJSONFields(nested, fieldType); err != nil {
					return err
				}
			}
		case reflect.Map:
			if target.Key().Kind() != reflect.String {
				return ErrInvalidJSONBody
			}
			for _, nested := range decoded {
				if err := validateExactJSONFields(nested, target.Elem()); err != nil {
					return err
				}
			}
		case reflect.Interface:
			return nil
		default:
			return ErrInvalidJSONBody
		}
	case []any:
		switch target.Kind() {
		case reflect.Slice, reflect.Array:
			for _, nested := range decoded {
				if err := validateExactJSONFields(nested, target.Elem()); err != nil {
					return err
				}
			}
		case reflect.Interface:
			return nil
		default:
			return ErrInvalidJSONBody
		}
	}
	return nil
}

func jsonStructFields(target reflect.Type) map[string]reflect.Type {
	fields := make(map[string]reflect.Type, target.NumField())
	for index := range target.NumField() {
		field := target.Field(index)
		if field.PkgPath != "" {
			continue
		}
		name := field.Tag.Get("json")
		if name == "-" {
			continue
		}
		if comma := bytes.IndexByte([]byte(name), ','); comma >= 0 {
			name = name[:comma]
		}
		if name == "" {
			name = field.Name
		}
		fields[name] = field.Type
	}
	return fields
}

func DecodeBoundedBase64(value string, minimumBytes int, maximumBytes int) ([]byte, error) {
	if minimumBytes < 0 || maximumBytes < minimumBytes {
		return nil, ErrInvalidBase64
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(value)
	if err != nil || base64.StdEncoding.EncodeToString(decoded) != value {
		clear(decoded)
		return nil, ErrInvalidBase64
	}
	if len(decoded) < minimumBytes || len(decoded) > maximumBytes {
		clear(decoded)
		return nil, ErrInvalidBase64
	}
	return decoded, nil
}
