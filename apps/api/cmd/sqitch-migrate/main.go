package main

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

var databaseNamePattern = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,63}$`)

func main() {
	if err := run(os.Args[1:]); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(arguments []string) error {
	directURL := strings.TrimSpace(os.Getenv("DIRECT_URL"))
	if directURL == "" {
		return errors.New("DIRECT_URL is required for Sqitch migrations")
	}
	target, postgresEnvironment, err := deriveSqitchConfiguration(directURL)
	if err != nil {
		return err
	}
	command := exec.Command("sqitch", arguments...)
	command.Env = migrationEnvironment(os.Environ(), target, postgresEnvironment)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		var exitError *exec.ExitError
		if errors.As(err, &exitError) {
			os.Exit(exitError.ExitCode())
		}
		return errors.New("Sqitch command could not start")
	}
	return nil
}

func deriveSqitchConfiguration(directURL string) (string, map[string]string, error) {
	parsed, err := url.Parse(strings.TrimSpace(directURL))
	if err != nil || parsed.Opaque != "" || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") ||
		parsed.Hostname() == "" || parsed.Fragment != "" || parsed.User == nil {
		return "", nil, errors.New("DIRECT_URL must be a PostgreSQL connection URL")
	}
	username := parsed.User.Username()
	if strings.TrimSpace(username) == "" {
		return "", nil, errors.New("DIRECT_URL must include a database username")
	}
	database := strings.TrimPrefix(parsed.EscapedPath(), "/")
	database, err = url.PathUnescape(database)
	if err != nil || !databaseNamePattern.MatchString(database) {
		return "", nil, errors.New("DIRECT_URL must include a valid database name")
	}
	port := parsed.Port()
	if port == "" {
		port = "5432"
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65_535 {
		return "", nil, errors.New("DIRECT_URL port is invalid")
	}
	target := "db:pg://" + net.JoinHostPort(parsed.Hostname(), strconv.Itoa(portNumber)) + "/" + database
	environment := map[string]string{
		"PGHOST":     parsed.Hostname(),
		"PGPORT":     strconv.Itoa(portNumber),
		"PGDATABASE": database,
		"PGUSER":     username,
		"PGOPTIONS":  "-c search_path=public",
	}
	if password, exists := parsed.User.Password(); exists {
		environment["PGPASSWORD"] = password
	}
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil {
		return "", nil, errors.New("DIRECT_URL query parameters are invalid")
	}
	for name, values := range query {
		if len(values) != 1 {
			return "", nil, errors.New("DIRECT_URL contains repeated connection parameters")
		}
		value := values[0]
		if name == "schema" {
			if value != "public" {
				return "", nil, errors.New("DIRECT_URL schema must be public")
			}
			continue
		}
		environmentName, allowed := postgresParameterEnvironment[name]
		if !allowed || strings.ContainsAny(value, "\x00\r\n") {
			return "", nil, errors.New("DIRECT_URL contains an unsupported connection parameter")
		}
		if name == "options" {
			value = strings.TrimSpace(value + " -c search_path=public")
		}
		environment[environmentName] = value
	}
	return target, environment, nil
}

var postgresParameterEnvironment = map[string]string{
	"application_name":     "PGAPPNAME",
	"channel_binding":      "PGCHANNELBINDING",
	"connect_timeout":      "PGCONNECT_TIMEOUT",
	"gssencmode":           "PGGSSENCMODE",
	"keepalives":           "PGKEEPALIVES",
	"keepalives_idle":      "PGKEEPALIVES_IDLE",
	"options":              "PGOPTIONS",
	"sslcert":              "PGSSLCERT",
	"sslkey":               "PGSSLKEY",
	"sslmode":              "PGSSLMODE",
	"sslrootcert":          "PGSSLROOTCERT",
	"target_session_attrs": "PGTARGETSESSIONATTRS",
	"tcp_user_timeout":     "PGTCPUSER_TIMEOUT",
}

func migrationEnvironment(current []string, target string, postgresEnvironment map[string]string) []string {
	values := make(map[string]string, len(current)+len(postgresEnvironment)+1)
	for _, entry := range current {
		name, value, found := strings.Cut(entry, "=")
		if !found || name == "DIRECT_URL" || name == "DATABASE_URL" || name == "SQITCH_TARGET" || strings.HasPrefix(name, "PG") {
			continue
		}
		values[name] = value
	}
	values["SQITCH_TARGET"] = target
	for name, value := range postgresEnvironment {
		values[name] = value
	}
	environment := make([]string, 0, len(values))
	for name, value := range values {
		environment = append(environment, name+"="+value)
	}
	return environment
}
