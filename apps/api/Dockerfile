# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM golang:1.27.4-alpine3.24@sha256:0a5f7fe796599ff487605987432e7619ae45beeb2fba4c2ce0b907879932aebf AS build
ARG TARGETOS
ARG TARGETARCH
ARG COMMIT_SHA=unknown
ARG PRODUCT_VERSION=dev
WORKDIR /workspace/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/cmd ./cmd
COPY apps/api/internal ./internal
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} \
    go build -trimpath -buildvcs=false \
      -ldflags="-s -w -X github.com/nooroctavian/rhasia-scret/apps/api/internal/buildinfo.Version=${PRODUCT_VERSION} -X github.com/nooroctavian/rhasia-scret/apps/api/internal/buildinfo.Commit=${COMMIT_SHA}" \
      -o /out/api ./cmd/api

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b AS runtime
ARG COMMIT_SHA
LABEL org.opencontainers.image.revision="${COMMIT_SHA}"
RUN apk add --no-cache ca-certificates \
  && addgroup -S -g 10001 api \
  && adduser -S -D -H -u 10001 -G api api
ENV NODE_ENV=production
ENV PORT=8787
ENV HOME=/tmp
WORKDIR /app
COPY --from=build --chown=10001:10001 /out/api /usr/local/bin/api
USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/api"]
CMD ["serve"]
