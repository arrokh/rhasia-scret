package testsupport

import "testing"

func TestIsPostgres16Image(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		image string
		want  bool
	}{
		{name: "short official image", image: "postgres:16-alpine", want: true},
		{name: "canonical Docker Hub image", image: "docker.io/library/postgres:16-alpine", want: true},
		{name: "official default tag", image: "postgres:16", want: true},
		{name: "other major version", image: "postgres:15-alpine", want: false},
		{name: "longer major version prefix", image: "postgres:160-alpine", want: false},
		{name: "untrusted registry", image: "registry.example.test/library/postgres:16-alpine", want: false},
		{name: "non-official Docker Hub repository", image: "docker.io/other/postgres:16-alpine", want: false},
		{name: "unrelated image", image: "not-postgres:16-alpine", want: false},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			if got := isPostgres16Image(testCase.image); got != testCase.want {
				t.Errorf("isPostgres16Image(%q) = %t, want %t", testCase.image, got, testCase.want)
			}
		})
	}
}
