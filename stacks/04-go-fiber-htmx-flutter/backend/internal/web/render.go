// Package web — template set bindings. Each renderFunc renders one named
// template with the given model. Parsing happened in Load; this file only
// wires the names.
package web

import (
	"bytes"
	"html/template"
)

// bytesBuffer is a local alias to keep imports tidy.
type bytesBuffer = bytes.Buffer

// NewTemplates builds the template render functions from the parsed tree.
func NewTemplates(t *template.Template) *Templates {
	return &Templates{
		Home:      renderNamed(t, "home"),
		Login:     renderNamed(t, "login"),
		Register:  renderNamed(t, "register"),
		Algorithm: renderNamed(t, "algorithm"),
		Form:      renderNamed(t, "login-form"),
		RunResult: renderNamed(t, "run-result"),
	}
}

func renderNamed(t *template.Template, name string) renderFunc {
	return func(data any) (string, error) {
		cloned := template.Must(t.Clone())
		var out bytesBuffer
		if err := cloned.ExecuteTemplate(&out, name, data); err != nil {
			return "", err
		}
		return out.String(), nil
	}
}
