package entity

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
)

type UserEncryptionPublicKey struct {
	Kty    string    `json:"kty"`
	Crv    string    `json:"crv"`
	X      string    `json:"x"`
	Y      string    `json:"y"`
	Ext    *bool     `json:"ext,omitempty"`
	KeyOps *[]string `json:"key_ops,omitempty"`
}

func ParseUserEncryptionPublicKey(raw []byte) (UserEncryptionPublicKey, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	for name := range fields {
		switch name {
		case "kty", "crv", "x", "y", "ext", "key_ops":
		default:
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
	}
	key := UserEncryptionPublicKey{}
	if err := decodeRequiredJSONString(fields, "kty", &key.Kty); err != nil || key.Kty != "EC" {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	if err := decodeRequiredJSONString(fields, "crv", &key.Crv); err != nil || key.Crv != "P-256" {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	if err := decodeRequiredJSONString(fields, "x", &key.X); err != nil || !validPublicKeyCoordinate(key.X) {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	if err := decodeRequiredJSONString(fields, "y", &key.Y); err != nil || !validPublicKeyCoordinate(key.Y) {
		return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
	}
	if rawExt, ok := fields["ext"]; ok {
		if bytes.Equal(bytes.TrimSpace(rawExt), []byte("null")) {
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
		var ext bool
		if err := json.Unmarshal(rawExt, &ext); err != nil {
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
		key.Ext = &ext
	}
	if rawKeyOps, ok := fields["key_ops"]; ok {
		if bytes.Equal(bytes.TrimSpace(rawKeyOps), []byte("null")) {
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
		var operations []json.RawMessage
		if err := json.Unmarshal(rawKeyOps, &operations); err != nil || operations == nil || len(operations) > 8 {
			return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
		}
		values := make([]string, len(operations))
		for index, operation := range operations {
			if bytes.Equal(bytes.TrimSpace(operation), []byte("null")) {
				return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
			}
			if err := json.Unmarshal(operation, &values[index]); err != nil {
				return UserEncryptionPublicKey{}, errors.New("public encryption key is invalid")
			}
		}
		key.KeyOps = &values
	}
	return key, nil
}

func ValidateUserEncryptionPublicKey(key UserEncryptionPublicKey) error {
	serialized, err := json.Marshal(key)
	if err != nil {
		return errors.New("public encryption key is invalid")
	}
	_, err = ParseUserEncryptionPublicKey(serialized)
	return err
}

func PublicEncryptionKeysEqual(left, right UserEncryptionPublicKey) bool {
	return left.Kty == right.Kty && left.Crv == right.Crv && left.X == right.X && left.Y == right.Y &&
		reflect.DeepEqual(left.Ext, right.Ext) && reflect.DeepEqual(left.KeyOps, right.KeyOps)
}

func decodeRequiredJSONString(fields map[string]json.RawMessage, name string, target *string) error {
	raw, ok := fields[name]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return errors.New("public encryption key is invalid")
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return errors.New("public encryption key is invalid")
	}
	return nil
}

func validPublicKeyCoordinate(value string) bool {
	if len(value) != 43 {
		return false
	}
	for _, character := range value {
		if !(character >= 'A' && character <= 'Z') && !(character >= 'a' && character <= 'z') &&
			!(character >= '0' && character <= '9') && character != '_' && character != '-' {
			return false
		}
	}
	return true
}
