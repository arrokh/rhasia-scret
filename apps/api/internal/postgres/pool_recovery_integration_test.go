package postgres_test

import (
	"context"
	"net"
	"net/url"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nooroctavian/rhasia-scret/apps/api/internal/postgres"
	"github.com/nooroctavian/rhasia-scret/apps/api/internal/testsupport"
)

func TestPoolReplacesConnectionAfterStalledIdlePing(t *testing.T) {
	adminPool := testsupport.NewDisposablePostgresPool(t)
	if adminPool.Stat().TotalConns() == 0 {
		t.Fatal("disposable PostgreSQL pool did not establish a connection")
	}

	databaseURL := os.Getenv("RHSIA_GO_INTEGRATION_DATABASE_URL")
	parsedURL, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal("parse disposable PostgreSQL URL")
	}
	proxy, err := newStallingPostgresProxy(parsedURL.Host)
	if err != nil {
		t.Fatal("start local PostgreSQL proxy")
	}
	var pool *pgxpool.Pool
	defer func() {
		proxy.Close()
		if pool != nil {
			pool.Close()
		}
	}()

	configuration, err := postgres.ParseRuntimePoolConfig(databaseURL)
	if err != nil {
		t.Fatal("parse disposable PostgreSQL pool configuration")
	}
	if configuration.MaxConns != postgres.APIConnectionLimit {
		t.Fatalf("configured pool limit = %d; want %d", configuration.MaxConns, postgres.APIConnectionLimit)
	}
	configuration.ShouldPing = func(context.Context, pgxpool.ShouldPingParams) bool { return true }
	configuration.ConnConfig.DialFunc = func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", proxy.Address())
	}
	pool, err = pgxpool.NewWithConfig(context.Background(), configuration)
	if err != nil {
		t.Fatal("create PostgreSQL pool through local proxy")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		t.Fatal("establish proxied PostgreSQL connection")
	}
	connectionsBefore := pool.Stat().NewConnsCount()
	if connectionsBefore != 1 {
		t.Fatalf("initial pool connection count = %d; want 1", connectionsBefore)
	}

	proxy.StallExisting()
	var result int
	if err := pool.QueryRow(ctx, `SELECT 1`).Scan(&result); err != nil {
		t.Fatalf("query after a stalled idle connection ping: %v", err)
	}
	if result != 1 {
		t.Fatalf("query result = %d; want 1", result)
	}
	if connectionsAfter := pool.Stat().NewConnsCount(); connectionsAfter <= connectionsBefore {
		t.Fatalf("pool opened %d connections; want a fresh connection after the stalled ping", connectionsAfter)
	}
}

type stallingPostgresProxy struct {
	listener    net.Listener
	target      string
	mutex       sync.Mutex
	connections []*proxiedConnection
	closed      chan struct{}
	waitGroup   sync.WaitGroup
}

type proxiedConnection struct {
	client  net.Conn
	server  net.Conn
	stalled atomic.Bool
	once    sync.Once
}

func newStallingPostgresProxy(target string) (*stallingPostgresProxy, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	proxy := &stallingPostgresProxy{
		listener: listener,
		target:   target,
		closed:   make(chan struct{}),
	}
	proxy.waitGroup.Add(1)
	go proxy.acceptConnections()
	return proxy, nil
}

func (proxy *stallingPostgresProxy) Address() string {
	return proxy.listener.Addr().String()
}

func (proxy *stallingPostgresProxy) StallExisting() {
	proxy.mutex.Lock()
	defer proxy.mutex.Unlock()
	for _, connection := range proxy.connections {
		connection.stalled.Store(true)
	}
}

func (proxy *stallingPostgresProxy) Close() {
	close(proxy.closed)
	_ = proxy.listener.Close()
	proxy.mutex.Lock()
	for _, connection := range proxy.connections {
		connection.close()
	}
	proxy.mutex.Unlock()
	proxy.waitGroup.Wait()
}

func (proxy *stallingPostgresProxy) acceptConnections() {
	defer proxy.waitGroup.Done()
	for {
		client, err := proxy.listener.Accept()
		if err != nil {
			return
		}
		server, err := net.DialTimeout("tcp", proxy.target, 2*time.Second)
		if err != nil {
			_ = client.Close()
			continue
		}
		connection := &proxiedConnection{client: client, server: server}
		proxy.mutex.Lock()
		proxy.connections = append(proxy.connections, connection)
		proxy.mutex.Unlock()
		proxy.waitGroup.Add(2)
		go proxy.forward(connection, client, server)
		go proxy.forward(connection, server, client)
	}
}

func (proxy *stallingPostgresProxy) forward(connection *proxiedConnection, source, destination net.Conn) {
	defer proxy.waitGroup.Done()
	buffer := make([]byte, 32*1024)
	for {
		read, err := source.Read(buffer)
		if read > 0 && !connection.stalled.Load() {
			if _, writeErr := destination.Write(buffer[:read]); writeErr != nil {
				connection.close()
				return
			}
		}
		if err != nil {
			connection.close()
			return
		}
		select {
		case <-proxy.closed:
			connection.close()
			return
		default:
		}
	}
}

func (connection *proxiedConnection) close() {
	connection.once.Do(func() {
		_ = connection.client.Close()
		_ = connection.server.Close()
	})
}
