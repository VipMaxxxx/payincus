# Communication, Tickets and Help

Communication features cover customer support, operational announcements, system alerts and delivery status.

## User Features

| Feature | Description |
| --- | --- |
| Tickets | Submit issues, upload attachments, read replies and close tickets. |
| Inbox | Read system messages, billing reminders and resource alerts. |
| Help center | Read help articles maintained by administrators. |
| Popup announcements | Receive maintenance and important operation notices. |

## Admin Features

- View, filter, reply to and close tickets.
- Manage help articles.
- Publish announcements and broadcasts.
- Configure notification channels.
- Review delivery logs and failure reasons.

## Delivery Channels

- Inbox messages for default in-app notifications.
- SMTP for email verification, ticket reminders and system mail.
- Telegram for admin alerts, user binding and critical events.
- Lsky for ticket images or attachment workflows.

## Risks

- Ticket attachments must enforce size, type and permission checks.
- Notification failures must not block core billing or delivery operations.
- Telegram webhook URLs and tokens must remain secret.
- SMTP and Lsky secrets must be redacted from logs.
