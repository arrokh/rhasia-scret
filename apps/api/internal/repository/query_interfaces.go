package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type RowsQueryer interface {
	Queryer
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

type Executor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}
