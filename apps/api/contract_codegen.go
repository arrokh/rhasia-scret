// Package api has no runtime code here; the directive pins OpenAPI code generation.
package api

//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.2 -config oapi-codegen.yaml ../../packages/api-contract/openapi.yaml
