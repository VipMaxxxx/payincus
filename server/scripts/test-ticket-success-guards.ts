import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSource = readFileSync(resolve(process.cwd(), 'src/routes/tickets.ts'), 'utf8')
const dbSource = readFileSync(resolve(process.cwd(), 'src/db/tickets.ts'), 'utf8')
const schemaSource = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8')
const migrationSource = readFileSync(resolve(process.cwd(), 'prisma/migrations/20260624233000_add_ticket_success_center/migration.sql'), 'utf8')
const apiSource = readFileSync(resolve(process.cwd(), '../client/src/api/index.ts'), 'utf8')
const adminApiSource = readFileSync(resolve(process.cwd(), '../client/src/api/admin.ts'), 'utf8')
const ticketsViewSource = readFileSync(resolve(process.cwd(), '../client/src/views/TicketsView.vue'), 'utf8')
const typesSource = readFileSync(resolve(process.cwd(), '../client/src/types/api.ts'), 'utf8')
const zhCnLocale = readFileSync(resolve(process.cwd(), '../client/src/locales/zh-CN.ts'), 'utf8')
const enLocale = readFileSync(resolve(process.cwd(), '../client/src/locales/en.ts'), 'utf8')

assert.ok(
  schemaSource.includes('firstResponseDueAt DateTime? @map("first_response_due_at")') &&
    schemaSource.includes('resolutionDueAt    DateTime? @map("resolution_due_at")') &&
    schemaSource.includes('firstRespondedAt   DateTime? @map("first_responded_at")') &&
    schemaSource.includes('model TicketInternalNote') &&
    schemaSource.includes('model TicketObjectLink') &&
    schemaSource.includes('enum TicketObjectLinkType') &&
    migrationSource.includes('CREATE TYPE "TicketObjectLinkType"') &&
    migrationSource.includes('ALTER TABLE "tickets"') &&
    migrationSource.includes('CREATE TABLE "ticket_internal_notes"') &&
    migrationSource.includes('CREATE TABLE "ticket_object_links"') &&
    migrationSource.includes('ticket_object_links_ticket_id_object_type_object_id_key'),
  'Ticket success center must persist SLA fields, internal notes and linked objects'
)

assert.ok(
  routeSource.includes("('/:id/support-context'") &&
    routeSource.includes("('/:id/internal-notes'") &&
    routeSource.includes("('/:id/links'") &&
    routeSource.includes("('/:id/notify'") &&
    routeSource.match(/fastify\.authenticate,\s*fastify\.requireAdmin/g)?.length &&
    routeSource.includes('getAdminTicketSuccessContext') &&
    routeSource.includes('createTicketInternalNote') &&
    routeSource.includes('createTicketObjectLink'),
  'Support context, internal notes, linked objects and notify endpoints must be admin-only'
)

assert.ok(
  dbSource.includes('getSlaMinutes') &&
    dbSource.includes('firstResponseDueAt: addMinutes') &&
    dbSource.includes('resolutionDueAt: addMinutes') &&
    dbSource.includes('firstRespondedAt: new Date()') &&
    dbSource.includes('computeSlaStatus') &&
    dbSource.includes("queue?: 'pending' | 'due_soon' | 'overdue' | 'waiting_user' | 'waiting_internal'"),
  'Ticket SLA deadlines, first response tracking and queue filters must be implemented'
)

assert.ok(
  dbSource.includes('maskEmail') &&
    dbSource.includes('emailMasked') &&
    dbSource.includes('recentOrders') &&
    dbSource.includes('recentDeliveryCases') &&
    dbSource.includes('recentAlerts') &&
    dbSource.includes('knowledgeSuggestions') &&
    !dbSource.includes('callbackData') &&
    !dbSource.includes('providerConfigSnapshot') &&
    !dbSource.includes('rootPassword') &&
    !dbSource.includes('twoFactorSecret') &&
    !dbSource.includes('twoFactorRecoveryCodes') &&
    !dbSource.includes('ip: true') &&
    !dbSource.includes('userAgent: true'),
  'Support context must aggregate useful data without leaking secrets, raw callbacks, IPs or root passwords'
)

assert.ok(
  routeSource.includes("sendNotification(ticket.userId, 'ticket_replied'") &&
    routeSource.includes('已向用户发送通知') &&
    !routeSource.includes('adjustBalance') &&
    !routeSource.includes('changeBalance') &&
    !routeSource.includes('createInstanceAsync') &&
    !routeSource.includes('deleteInstance') &&
    !routeSource.includes('destroyInstance'),
  'Support quick actions must notify or record notes only, not bypass finance/resource approval flows'
)

assert.ok(
  apiSource.includes('getSupportContext') &&
    apiSource.includes('createInternalNote') &&
    apiSource.includes('linkObject') &&
    apiSource.includes('notifyUser') &&
    adminApiSource.includes('getSupportContext') &&
    typesSource.includes('export interface TicketSupportContext') &&
    typesSource.includes('export interface TicketInternalNote') &&
    typesSource.includes('export interface TicketObjectLink'),
  'Client API and types must expose ticket success center calls'
)

assert.ok(
  ticketsViewSource.includes('supportContext') &&
    ticketsViewSource.includes('queueFilter') &&
    ticketsViewSource.includes('submitInternalNote') &&
    ticketsViewSource.includes('submitLinkObject') &&
    ticketsViewSource.includes('submitNotifyUser') &&
    ticketsViewSource.includes("v-if=\"authStore.isAdmin\"") &&
    ticketsViewSource.includes('tickets.support.internalNotes') &&
    ticketsViewSource.includes('tickets.support.timeline'),
  'Admin ticket UI must show support context, queues, notes, links, timeline and admin-only controls'
)

assert.ok(
  ticketsViewSource.includes("toast.error(t('tickets.contentTooShort'))") &&
    !ticketsViewSource.includes("toast.error(t('tickets.content') + ' ' + t('common.error'))") &&
    zhCnLocale.includes('contentTooShort:') &&
    zhCnLocale.includes('工单内容至少需要 10 个字符') &&
    enLocale.includes('Ticket content must be at least 10 characters'),
  'Ticket create validation must show a specific content length message instead of a generic operation failure'
)

console.log('Ticket success guard tests passed')
