package application

import "context"

type EmailMessage struct {
	Subject string
	Text    string
	HTML    string
}

type EmailDelivery interface {
	SendEmail(context.Context, string, EmailMessage) error
}
