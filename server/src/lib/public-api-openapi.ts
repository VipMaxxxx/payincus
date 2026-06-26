function yamlScalar(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(String(value))
}

function yamlKey(key: string): string {
  return JSON.stringify(key)
}

function toYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)
  if (value === null || typeof value !== 'object') return `${pad}${yamlScalar(value)}`
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`
    return value.map(item => {
      if (item === null || typeof item !== 'object') return `${pad}- ${yamlScalar(item)}`
      return `${pad}-\n${toYaml(item, indent + 2)}`
    }).join('\n')
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return `${pad}{}`
  return entries.map(([key, item]) => {
    if (item === null || typeof item !== 'object') {
      return `${pad}${yamlKey(key)}: ${yamlScalar(item)}`
    }
    return `${pad}${yamlKey(key)}:\n${toYaml(item, indent + 2)}`
  }).join('\n')
}

export function stringifyPublicApiOpenApiYaml(document: unknown = buildPublicApiOpenApiDocument()): string {
  return `${toYaml(document)}\n`
}

export function buildPublicApiOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'PayIncus Public API',
      version: '0.1.0',
      description: 'Stable public API surface for PayIncus extensions and third-party integrations.'
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [
      {
        url: '/api/v1',
        description: 'Current PayIncus instance'
      }
    ],
    security: [
      {
        publicApiToken: []
      },
      {
        oauthAccessToken: []
      }
    ],
    tags: [
      {
        name: 'Profile',
        description: 'Authenticated public profile APIs.'
      },
      {
        name: 'Account',
        description: 'Authenticated account read APIs scoped to the current user.'
      },
      {
        name: 'Products',
        description: 'Read-only public product catalog APIs.'
      },
      {
        name: 'Services',
        description: 'Service APIs scoped to the authenticated user, including guarded start/stop/restart task queueing and renewal through the internal billing state machine.'
      },
      {
        name: 'Orders',
        description: 'Read-only order APIs scoped to the authenticated user.'
      },
      {
        name: 'Tickets',
        description: 'Support ticket APIs scoped to the authenticated user.'
      },
      {
        name: 'Notifications',
        description: 'User-scoped notification APIs for extensions and third-party integrations.'
      },
      {
        name: 'Plugin Actions',
        description: 'Public API bridge for invoking enabled plugin webhook actions.'
      },
      {
        name: 'API Tokens',
        description: 'User-authenticated token management APIs under /api/api-tokens.'
      },
      {
        name: 'OAuth Provider',
        description: 'OAuth authorization-code endpoints for third-party applications.'
      }
    ],
    paths: {
      '/me': {
        get: {
          tags: ['Profile'],
          summary: 'Read current API token user profile',
          description: 'Requires a Bearer API token or OAuth access token with profile:read scope.',
          operationId: 'getCurrentPublicApiProfile',
          security: [{ publicApiToken: ['profile:read'] }, { oauthAccessToken: ['profile:read'] }],
          responses: {
            '200': {
              description: 'Current user profile.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiProfile' },
                      meta: { $ref: '#/components/schemas/PublicApiTokenMeta' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        },
        patch: {
          tags: ['Profile'],
          summary: 'Update current API token user profile',
          description: 'Requires profile:write scope. Only low-risk profile fields are accepted; email, password, role, status, balance, and security settings cannot be changed through this endpoint.',
          operationId: 'updateCurrentPublicApiProfile',
          security: [{ publicApiToken: ['profile:write'] }, { oauthAccessToken: ['profile:write'] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdatePublicApiProfileRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Updated current user profile.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiProfile' },
                      meta: { $ref: '#/components/schemas/PublicApiTokenMeta' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/balance': {
        get: {
          tags: ['Account'],
          summary: 'Read current user balance',
          description: 'Requires balance:read scope. Returns only the authenticated user account balance; recharge, debit, refund, adjustment, and cross-user balance operations are not exposed.',
          operationId: 'getCurrentPublicApiBalance',
          security: [{ publicApiToken: ['balance:read'] }, { oauthAccessToken: ['balance:read'] }],
          responses: {
            '200': {
              description: 'Current user balance.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiBalance' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/balance/logs': {
        get: {
          tags: ['Account'],
          summary: 'List current user balance logs',
          description: 'Requires balance:read scope. Returns only the authenticated user account balance ledger with safe instance metadata; payment provider payloads, adjustment request objects, and other users are not exposed.',
          operationId: 'listCurrentPublicApiBalanceLogs',
          security: [{ publicApiToken: ['balance:read'] }, { oauthAccessToken: ['balance:read'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', '-createdAt'], default: '-createdAt' } },
            {
              name: 'type',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['recharge', 'consume', 'refund', 'admin_adjust', 'gift', 'transfer_fee', 'transfer_refund', 'hosting_withdraw', 'hosting_deduction', 'invite_generate']
              }
            },
            {
              name: 'lotteryGift',
              in: 'query',
              schema: { type: 'string', enum: ['exclude', 'only'] }
            }
          ],
          responses: {
            '200': {
              description: 'Current user balance ledger.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiBalanceLog' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/balance/adjustment-requests': {
        get: {
          tags: ['Account'],
          summary: 'List current user balance adjustment requests',
          description: 'Requires balance:write scope. Returns only pending/approved/rejected adjustment requests created by the authenticated token user through the public API. It does not expose other users, admin-only adjustment requests, payment provider payloads, or raw approval internals.',
          operationId: 'listCurrentPublicApiBalanceAdjustmentRequests',
          security: [{ publicApiToken: ['balance:write'] }, { oauthAccessToken: ['balance:write'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', '-createdAt'], default: '-createdAt' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'rejected'] } }
          ],
          responses: {
            '200': {
              description: 'Current user public API balance adjustment requests.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiBalanceAdjustmentRequest' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        },
        post: {
          tags: ['Account'],
          summary: 'Create a pending balance adjustment request',
          description: 'Requires balance:write scope. Creates a pending adjustment request for the authenticated token user only. This endpoint never changes balance, creates a payment, refunds funds, or writes a balance log directly; execution still requires the internal admin approval workflow.',
          operationId: 'createCurrentPublicApiBalanceAdjustmentRequest',
          security: [{ publicApiToken: ['balance:write'] }, { oauthAccessToken: ['balance:write'] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreatePublicApiBalanceAdjustmentRequest' }
              }
            }
          },
          responses: {
            '202': {
              description: 'Pending balance adjustment request accepted for admin review.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiBalanceAdjustmentRequest' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        }
      },
      '/products': {
        get: {
          tags: ['Products'],
          summary: 'List active products',
          description: 'Requires products:read scope. Returns active packages and active plans only.',
          operationId: 'listPublicProducts',
          security: [{ publicApiToken: ['products:read'] }, { oauthAccessToken: ['products:read'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', '-createdAt'], default: '-createdAt' } }
          ],
          responses: {
            '200': {
              description: 'Active product list.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiProduct' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/products/{id}': {
        get: {
          tags: ['Products'],
          summary: 'Read one active product',
          description: 'Requires products:read scope. Returns active package and active plans only.',
          operationId: 'getPublicProduct',
          security: [{ publicApiToken: ['products:read'] }, { oauthAccessToken: ['products:read'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          responses: {
            '200': {
              description: 'Active product.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiProduct' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/orders': {
        get: {
          tags: ['Orders'],
          summary: 'List current user orders',
          description: 'Requires orders:read scope. Returns user-scoped recharge and instance billing records with payment callback data and raw provider payloads omitted.',
          operationId: 'listPublicOrders',
          security: [{ publicApiToken: ['orders:read'] }, { oauthAccessToken: ['orders:read'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', '-createdAt'], default: '-createdAt' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'completed', 'failed', 'cancelled', 'refunded'] } }
          ],
          responses: {
            '200': {
              description: 'Current user order list.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiOrder' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/orders/{id}': {
        get: {
          tags: ['Orders'],
          summary: 'Read a current user order',
          description: 'Requires orders:read scope. Reads a single user-scoped recharge or instance billing order by public order id such as recharge:123 or instance_billing:456. Payment callback data, raw provider payloads, and full trade numbers are omitted.',
          operationId: 'getPublicOrder',
          security: [{ publicApiToken: ['orders:read'] }, { oauthAccessToken: ['orders:read'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^(recharge|instance_billing):[1-9]\\d*$' } }
          ],
          responses: {
            '200': {
              description: 'Current user order.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiOrder' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/billing-records': {
        get: {
          tags: ['Billing'],
          summary: 'List current user billing records',
          description: 'Requires billing:read scope. Returns only instance billing records owned by the authenticated user. It omits balance log objects, payment provider payloads, raw reconciliation data, and other users.',
          operationId: 'listPublicBillingRecords',
          security: [{ publicApiToken: ['billing:read'] }, { oauthAccessToken: ['billing:read'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', '-createdAt'], default: '-createdAt' } },
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['newPurchase', 'renew', 'upgrade', 'downgrade', 'refund', 'transfer_fee'] } },
            { name: 'serviceId', in: 'query', schema: { type: 'integer', minimum: 1 } }
          ],
          responses: {
            '200': {
              description: 'Current user billing records.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiBillingRecord' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/billing-records/{id}': {
        get: {
          tags: ['Billing'],
          summary: 'Read one current user billing record',
          description: 'Requires billing:read scope. Reads a single billing record only when it belongs to the authenticated user. It does not expose balance log internals, payment callbacks, or provider data.',
          operationId: 'getPublicBillingRecord',
          security: [{ publicApiToken: ['billing:read'] }, { oauthAccessToken: ['billing:read'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          responses: {
            '200': {
              description: 'Current user billing record.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiBillingRecord' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/services': {
        get: {
          tags: ['Services'],
          summary: 'List current user services',
          description: 'Requires services:read scope. Returns user-scoped service summaries without root passwords, Incus IDs, host internals, or privileged connection secrets. Optional include accepts product and plan only.',
          operationId: 'listPublicServices',
          security: [{ publicApiToken: ['services:read'] }, { oauthAccessToken: ['services:read'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['displayOrder', '-displayOrder', 'createdAt', '-createdAt'], default: 'displayOrder' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['creating', 'running', 'stopped', 'suspended', 'error', 'deleted'] } },
            { name: 'include', in: 'query', description: 'Comma-separated safe includes. Allowed values: product, plan.', schema: { type: 'string', pattern: '^(product|plan)(,(product|plan))*$' } }
          ],
          responses: {
            '200': {
              description: 'Current user service list.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiService' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' },
                      included: { $ref: '#/components/schemas/PublicApiServiceIncluded' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/services/{id}': {
        get: {
          tags: ['Services'],
          summary: 'Read one current user service',
          description: 'Requires services:read scope. Returns one user-scoped service without root passwords, Incus IDs, host internals, or privileged connection secrets. Optional include accepts product and plan only.',
          operationId: 'getPublicService',
          security: [{ publicApiToken: ['services:read'] }, { oauthAccessToken: ['services:read'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
            { name: 'include', in: 'query', description: 'Comma-separated safe includes. Allowed values: product, plan.', schema: { type: 'string', pattern: '^(product|plan)(,(product|plan))*$' } }
          ],
          responses: {
            '200': {
              description: 'Current user service.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiService' },
                      included: { $ref: '#/components/schemas/PublicApiServiceIncluded' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/services/{id}/actions': {
        post: {
          tags: ['Services'],
          summary: 'Queue a guarded service operation task',
          description: 'Requires services:operate scope. Queues start, stop, or restart for one service owned by the authenticated user. This write endpoint has a stricter public API rate limit. The endpoint does not expose delete, suspend, billing, host, Incus, or privileged connection operations.',
          operationId: 'queuePublicServiceAction',
          security: [{ publicApiToken: ['services:operate'] }, { oauthAccessToken: ['services:operate'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PublicApiServiceActionRequest' }
              }
            }
          },
          responses: {
            '202': {
              description: 'Service operation task queued.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiServiceActionResult' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { $ref: '#/components/responses/Conflict' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        }
      },
      '/services/{id}/renew': {
        post: {
          tags: ['Services'],
          summary: 'Renew one current user service',
          description: 'Requires services:billing scope. Renews one paid service owned by the authenticated user through the internal renewal transaction. The endpoint deducts user balance, creates billing records, applies AFF discounts and hosted-node renewal restrictions, and never exposes provider payloads or direct balance mutation controls.',
          operationId: 'renewPublicService',
          security: [{ publicApiToken: ['services:billing'] }, { oauthAccessToken: ['services:billing'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PublicApiServiceRenewRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Service renewed.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiServiceRenewResult' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/services/{id}/tasks/{taskId}': {
        get: {
          tags: ['Services'],
          summary: 'Read a queued service operation task',
          description: 'Requires services:operate scope. Returns the status of a start, stop, or restart task for one service owned by the authenticated user. Polling has its own public API rate limit. Other instance task types are not exposed through the public API.',
          operationId: 'getPublicServiceTask',
          security: [{ publicApiToken: ['services:operate'] }, { oauthAccessToken: ['services:operate'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
            { name: 'taskId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          responses: {
            '200': {
              description: 'Service operation task status.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiServiceTask' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        },
        delete: {
          tags: ['Services'],
          summary: 'Cancel a pending service operation task',
          description: 'Requires services:operate scope. Cancels a pending start, stop, or restart task for one service owned by the authenticated user. This write endpoint has a stricter public API rate limit. Processing or completed tasks and non-public instance task types cannot be cancelled through the public API.',
          operationId: 'cancelPublicServiceTask',
          security: [{ publicApiToken: ['services:operate'] }, { oauthAccessToken: ['services:operate'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
            { name: 'taskId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          responses: {
            '200': {
              description: 'Cancelled service operation task.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiServiceTask' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { $ref: '#/components/responses/Conflict' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        }
      },
      '/tickets': {
        get: {
          tags: ['Tickets'],
          summary: 'List current user tickets',
          description: 'Requires tickets:read scope. Returns user-scoped ticket summaries and omits internal notes.',
          operationId: 'listPublicTickets',
          security: [{ publicApiToken: ['tickets:read'] }, { oauthAccessToken: ['tickets:read'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['updatedAt', '-updatedAt', 'createdAt', '-createdAt'], default: '-updatedAt' } },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] } },
            { name: 'category', in: 'query', schema: { type: 'string', enum: ['general', 'billing', 'technical', 'abuse'] } },
            { name: 'priority', in: 'query', schema: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } }
          ],
          responses: {
            '200': {
              description: 'Current user ticket summaries.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiTicketSummary' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        },
        post: {
          tags: ['Tickets'],
          summary: 'Create a current user ticket',
          description: 'Requires tickets:write scope. Creates a public support ticket for the authenticated token user. This write endpoint has a stricter public API rate limit. JSON requests create text tickets; multipart/form-data may include up to 6 image attachments in the images field. Internal notes, status overrides, target user overrides, arbitrary files, and storage provider IDs are not accepted.',
          operationId: 'createPublicTicket',
          security: [{ publicApiToken: ['tickets:write'] }, { oauthAccessToken: ['tickets:write'] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreatePublicApiTicketRequest' }
              },
              'multipart/form-data': {
                schema: { $ref: '#/components/schemas/CreatePublicApiTicketMultipartRequest' }
              }
            }
          },
          responses: {
            '201': {
              description: 'Ticket created.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiTicketCreateResult' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        }
      },
      '/tickets/{id}': {
        get: {
          tags: ['Tickets'],
          summary: 'Read one current user ticket',
          description: 'Requires tickets:read scope. Returns user-scoped ticket messages and safe attachment metadata only.',
          operationId: 'getPublicTicket',
          security: [{ publicApiToken: ['tickets:read'] }, { oauthAccessToken: ['tickets:read'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          responses: {
            '200': {
              description: 'Current user ticket detail.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiTicket' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/tickets/{id}/replies': {
        post: {
          tags: ['Tickets'],
          summary: 'Reply to one current user ticket',
          description: 'Requires tickets:write scope. Adds a public reply to the authenticated user own non-closed ticket. This write endpoint has a stricter public API rate limit. JSON requests create text replies; multipart/form-data may include up to 6 image attachments in the images field. Internal notes, status overrides, arbitrary files, and storage provider IDs are not accepted.',
          operationId: 'createPublicTicketReply',
          security: [{ publicApiToken: ['tickets:write'] }, { oauthAccessToken: ['tickets:write'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreatePublicApiTicketReplyRequest' }
              },
              'multipart/form-data': {
                schema: { $ref: '#/components/schemas/CreatePublicApiTicketReplyMultipartRequest' }
              }
            }
          },
          responses: {
            '201': {
              description: 'Ticket reply created.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiTicketMessage' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { $ref: '#/components/responses/Conflict' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        }
      },
      '/tickets/{id}/status': {
        patch: {
          tags: ['Tickets'],
          summary: 'Close or reopen one current user ticket',
          description: 'Requires tickets:write scope. Only allows the authenticated user to close their own ticket or reopen their own closed ticket. This write endpoint has a stricter public API rate limit. Priority, category, internal notes, assignment, and cross-user status changes are not accepted.',
          operationId: 'updatePublicTicketStatus',
          security: [{ publicApiToken: ['tickets:write'] }, { oauthAccessToken: ['tickets:write'] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdatePublicApiTicketStatusRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Ticket status updated.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiTicketStatusResult' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' },
            '409': { $ref: '#/components/responses/Conflict' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        }
      },
      '/notifications': {
        get: {
          tags: ['Notifications'],
          summary: 'List current user notifications',
          description: 'Requires notifications:read scope. Returns current user inbox notifications only; raw event data, channels, broadcast targets, and other users are not exposed.',
          operationId: 'listPublicNotifications',
          security: [{ publicApiToken: ['notifications:read'] }, { oauthAccessToken: ['notifications:read'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['createdAt', '-createdAt'], default: '-createdAt' } },
            { name: 'isRead', in: 'query', schema: { type: 'boolean' } }
          ],
          responses: {
            '200': {
              description: 'Current user notifications.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiNotification' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        },
        post: {
          tags: ['Notifications'],
          summary: 'Send a self notification',
          description: 'Requires notifications:send scope. Sends a short notification only to the authenticated token user. This write endpoint has a stricter public API rate limit. Requests may either provide title/message, use a controlled platform template, or use an enabled plugin-declared template in the form plugin:<pluginId>:<templateId> with scalar variables. User overrides, broadcast, channel selection, HTML, and arbitrary internal event types are not accepted.',
          operationId: 'sendPublicNotification',
          security: [{ publicApiToken: ['notifications:send'] }, { oauthAccessToken: ['notifications:send'] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreatePublicApiNotificationRequest' }
              }
            }
          },
          responses: {
            '202': {
              description: 'Notification accepted for delivery.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiNotificationResult' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        }
      },
      '/notifications/unread-count': {
        get: {
          tags: ['Notifications'],
          summary: 'Read current user unread notification count',
          description: 'Requires notifications:read scope. Counts unread inbox notifications scoped to the authenticated token user.',
          operationId: 'getPublicUnreadNotificationCount',
          security: [{ publicApiToken: ['notifications:read'] }, { oauthAccessToken: ['notifications:read'] }],
          responses: {
            '200': {
              description: 'Unread notification count.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicApiUnreadNotificationCount' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/plugins': {
        get: {
          tags: ['Plugin Actions'],
          summary: 'List enabled public plugin actions',
          description: 'Requires plugins:action scope. Lists enabled plugin webhook actions that are public API callable. Webhook URLs, secrets, configuration values, service-extension hooks, and gateway-extension hooks are not exposed.',
          operationId: 'listPublicPluginActions',
          security: [{ publicApiToken: ['plugins:action'] }, { oauthAccessToken: ['plugins:action'] }],
          parameters: [
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'sort', in: 'query', schema: { type: 'string', enum: ['pluginId', '-pluginId', 'createdAt', '-createdAt'], default: 'pluginId' } }
          ],
          responses: {
            '200': {
              description: 'Enabled public plugin action catalog.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data', 'meta'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicPluginActionCatalogItem' }
                      },
                      meta: { $ref: '#/components/schemas/PublicApiPaginationMeta' }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' }
          }
        }
      },
      '/plugins/{pluginId}/actions': {
        get: {
          tags: ['Plugin Actions'],
          summary: 'List actions for an enabled plugin',
          description: 'Requires plugins:action scope. Returns only public API callable webhook action contracts for the enabled plugin.',
          operationId: 'getPublicPluginActions',
          security: [{ publicApiToken: ['plugins:action'] }, { oauthAccessToken: ['plugins:action'] }],
          parameters: [
            { name: 'pluginId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9-]*){2,}$' } }
          ],
          responses: {
            '200': {
              description: 'Enabled plugin public action catalog.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicPluginActionCatalog' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/plugins/{pluginId}/actions/{action}': {
        post: {
          tags: ['Plugin Actions'],
          summary: 'Dispatch an enabled plugin action',
          description: 'Requires plugins:action scope. Invokes a declared enabled public webhook action as the authenticated token user. This dispatch endpoint has a stricter public API route rate limit plus a database-backed token/plugin/action dynamic quota derived from the action rateLimit policy: normal actions allow 30 dispatches per minute by default and strict actions allow 10 dispatches per minute by default for the same token, plugin, and action across backend instances. Administrators can override the quota globally, per plugin, or per plugin action. The plugin manifest must grant plugin-action:run and every action scope required by the action. Service-extension and gateway-extension lifecycle actions cannot be dispatched through this public endpoint.',
          operationId: 'dispatchPublicPluginAction',
          security: [{ publicApiToken: ['plugins:action'] }, { oauthAccessToken: ['plugins:action'] }],
          parameters: [
            { name: 'pluginId', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9-]*){2,}$' } },
            { name: 'action', in: 'path', required: true, schema: { type: 'string', minLength: 1, maxLength: 80 } }
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DispatchPublicPluginActionRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'Plugin action dispatch result.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: { $ref: '#/components/schemas/PublicPluginActionResult' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '403': { $ref: '#/components/responses/Forbidden' },
            '404': { $ref: '#/components/responses/NotFound' },
            '429': { $ref: '#/components/responses/TooManyRequests' }
          }
        }
      },
      '/api-tokens': {
        get: {
          tags: ['API Tokens'],
          summary: 'List API tokens for the logged-in user',
          description: 'This management endpoint is served at /api/api-tokens and requires the normal PayIncus session JWT.',
          operationId: 'listPublicApiTokens',
          security: [{ sessionJwt: [] }],
          responses: {
            '200': {
              description: 'Token list and allowed scopes.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['scopes', 'tokens'],
                    properties: {
                      scopes: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiScope' }
                      },
                      tokens: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiToken' }
                      }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        },
        post: {
          tags: ['API Tokens'],
          summary: 'Create an API token',
          description: 'This management endpoint is served at /api/api-tokens. The raw token is returned once and only its SHA256 hash is stored.',
          operationId: 'createPublicApiToken',
          security: [{ sessionJwt: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreatePublicApiTokenRequest' }
              }
            }
          },
          responses: {
            '201': {
              description: 'Created token. Store the token immediately.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CreatePublicApiTokenResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/api-tokens/{id}': {
        delete: {
          tags: ['API Tokens'],
          summary: 'Revoke an API token',
          description: 'This management endpoint is served at /api/api-tokens/{id}.',
          operationId: 'revokePublicApiToken',
          security: [{ sessionJwt: [] }],
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1 }
            }
          ],
          responses: {
            '200': {
              description: 'Token revoked.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['message'],
                    properties: { message: { type: 'string' } }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      },
      '/oauth-provider/token': {
        post: {
          tags: ['OAuth Provider'],
          summary: 'Exchange or refresh OAuth tokens',
          description: 'This endpoint is served at /api/oauth-provider/token and supports authorization_code and refresh_token grants. Refresh tokens are rotated and stored as SHA256 hashes.',
          operationId: 'exchangeOAuthToken',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OAuthTokenRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'OAuth access token response.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OAuthTokenResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' }
          }
        }
      },
      '/oauth-provider/scopes': {
        get: {
          tags: ['OAuth Provider'],
          summary: 'List OAuth and Public API scopes',
          description: 'This endpoint is served at /api/oauth-provider/scopes and returns the canonical scope metadata used by OAuth consent and Public API clients.',
          operationId: 'listOAuthProviderScopes',
          security: [],
          responses: {
            '200': {
              description: 'Canonical OAuth scope metadata.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['scopes', 'updatedAt'],
                    properties: {
                      scopes: { type: 'array', items: { $ref: '#/components/schemas/OAuthScopeMetadata' } },
                      updatedAt: { type: 'string', format: 'date-time' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/oauth-provider/authorize/consent': {
        get: {
          tags: ['OAuth Provider'],
          summary: 'Read OAuth consent request',
          description: 'This session-authenticated endpoint is served at /api/oauth-provider/authorize/consent and returns app, redirect URI, requested scopes, existing scopes, and consent requirement.',
          operationId: 'getOAuthConsentRequest',
          security: [{ sessionJwt: [] }],
          responses: {
            '200': {
              description: 'OAuth consent request.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OAuthConsentResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/oauth-provider/authorize/confirm': {
        post: {
          tags: ['OAuth Provider'],
          summary: 'Approve or deny OAuth consent',
          description: 'This session-authenticated endpoint is served at /api/oauth-provider/authorize/confirm and returns redirectTo with either code or access_denied.',
          operationId: 'confirmOAuthConsentRequest',
          security: [{ sessionJwt: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OAuthAuthorizeConfirmRequest' }
              }
            }
          },
          responses: {
            '200': {
              description: 'OAuth authorization redirect target.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OAuthAuthorizeResponse' }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/oauth-provider/authorizations': {
        get: {
          tags: ['OAuth Provider'],
          summary: 'List current user OAuth authorizations',
          description: 'This session-authenticated endpoint is served at /api/oauth-provider/authorizations.',
          operationId: 'listOAuthAuthorizations',
          security: [{ sessionJwt: [] }],
          responses: {
            '200': {
              description: 'Current user OAuth authorizations.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['authorizations'],
                    properties: {
                      authorizations: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/OAuthAuthorization' }
                      }
                    }
                  }
                }
              }
            },
            '401': { $ref: '#/components/responses/Unauthorized' }
          }
        }
      },
      '/oauth-provider/authorizations/{id}': {
        delete: {
          tags: ['OAuth Provider'],
          summary: 'Revoke one current user OAuth authorization',
          description: 'This session-authenticated endpoint revokes the grant and all linked OAuth access/refresh tokens.',
          operationId: 'revokeOAuthAuthorization',
          security: [{ sessionJwt: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } }
          ],
          responses: {
            '200': {
              description: 'OAuth authorization revoked.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['authorization'],
                    properties: {
                      authorization: { $ref: '#/components/schemas/OAuthAuthorization' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '404': { $ref: '#/components/responses/NotFound' }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        publicApiToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'pat'
        },
        oauthAccessToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'poa'
        },
        sessionJwt: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        PublicApiScope: {
          type: 'string',
          enum: ['profile:read', 'profile:write', 'balance:read', 'balance:write', 'billing:read', 'products:read', 'services:read', 'services:operate', 'services:billing', 'orders:read', 'tickets:read', 'tickets:write', 'notifications:read', 'notifications:send', 'plugins:action']
        },
        OAuthScopeMetadata: {
          type: 'object',
          required: ['scope', 'title', 'description', 'risk', 'access', 'resources', 'implemented', 'notes'],
          properties: {
            scope: { $ref: '#/components/schemas/PublicApiScope' },
            title: { type: 'string' },
            description: { type: 'string' },
            risk: { type: 'string', enum: ['low', 'medium', 'high'] },
            access: { type: 'string', enum: ['read', 'write', 'operate'] },
            resources: { type: 'array', items: { type: 'string' } },
            implemented: { type: 'boolean' },
            notes: { type: 'array', items: { type: 'string' } }
          }
        },
        PublicApiPaginationMeta: {
          type: 'object',
          required: ['page', 'pageSize', 'total', 'totalPages'],
          properties: {
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
            total: { type: 'integer', minimum: 0 },
            totalPages: { type: 'integer', minimum: 1 },
            sort: { type: 'string', description: 'Effective public API sort key. Prefix with - for descending order.' }
          }
        },
        PublicApiProfile: {
          type: 'object',
          required: ['id', 'username', 'email', 'role', 'avatarStyle', 'avatarBadgeId'],
          properties: {
            id: { type: 'integer' },
            username: { type: 'string' },
            email: { type: ['string', 'null'], format: 'email' },
            role: { type: 'string', enum: ['admin', 'user'] },
            avatarStyle: { type: 'string' },
            avatarBadgeId: { type: ['string', 'null'] }
          }
        },
        UpdatePublicApiProfileRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['avatarStyle'],
          properties: {
            avatarStyle: {
              type: 'string',
              enum: [
                'adventurer', 'adventurerNeutral', 'avataaars', 'avataaarsNeutral',
                'bigEars', 'bigEarsNeutral', 'bigSmile', 'bottts', 'botttsNeutral',
                'croodles', 'croodlesNeutral', 'dylan', 'funEmoji', 'glass', 'icons',
                'identicon', 'initials', 'lorelei', 'loreleiNeutral', 'micah', 'miniavs',
                'notionists', 'notionistsNeutral', 'openPeeps', 'personas', 'pixelArt',
                'pixelArtNeutral', 'rings', 'shapes', 'thumbs'
              ]
            }
          }
        },
        PublicApiBalance: {
          type: 'object',
          required: ['userId', 'balance', 'currency', 'updatedAt'],
          properties: {
            userId: { type: 'integer' },
            balance: { type: 'number', description: 'Current account balance in the panel settlement currency.' },
            currency: { type: 'string', enum: ['CNY'] },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        PublicApiBalanceLog: {
          type: 'object',
          required: ['id', 'type', 'amount', 'balanceBefore', 'balanceAfter', 'orderId', 'instance', 'remark', 'createdAt'],
          properties: {
            id: { type: 'integer' },
            type: {
              type: 'string',
              enum: ['recharge', 'consume', 'refund', 'admin_adjust', 'gift', 'transfer_fee', 'transfer_refund', 'hosting_withdraw', 'hosting_deduction', 'invite_generate']
            },
            amount: { type: 'number' },
            balanceBefore: { type: 'number' },
            balanceAfter: { type: 'number' },
            orderId: { type: ['string', 'null'] },
            instance: {
              type: ['object', 'null'],
              required: ['id', 'name'],
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' }
              }
            },
            remark: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        CreatePublicApiBalanceAdjustmentRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['amount', 'reason'],
          properties: {
            amount: {
              type: 'number',
              minimum: 0.01,
              maximum: 10000,
              description: 'Positive amount requested for admin review. It is not credited until approved internally.'
            },
            requestType: { type: 'string', enum: ['manual_adjust', 'refund'], default: 'manual_adjust' },
            reason: { type: 'string', minLength: 10, maxLength: 500 },
            orderNo: { type: 'string', maxLength: 80 }
          }
        },
        PublicApiBalanceAdjustmentRequest: {
          type: 'object',
          required: ['id', 'userId', 'amount', 'requestType', 'status', 'orderNo', 'reason', 'reviewRemark', 'createdAt', 'updatedAt', 'reviewedAt'],
          properties: {
            id: { type: 'integer' },
            userId: { type: 'integer' },
            amount: { type: 'number' },
            requestType: { type: 'string', enum: ['manual_adjust', 'refund'] },
            status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
            orderNo: { type: ['string', 'null'] },
            reason: { type: 'string' },
            reviewRemark: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            reviewedAt: { type: ['string', 'null'], format: 'date-time' }
          }
        },
        PublicApiTokenMeta: {
          type: 'object',
          required: ['tokenId', 'scopes'],
          properties: {
            tokenId: { type: 'integer' },
            scopes: {
              type: 'array',
              items: { $ref: '#/components/schemas/PublicApiScope' }
            }
          }
        },
        PublicApiProduct: {
          type: 'object',
          required: ['id', 'name', 'description', 'instanceType', 'networkMode', 'active', 'limits', 'plans'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            instanceType: { type: 'string' },
            networkMode: { type: 'string' },
            active: { type: 'boolean' },
            limits: { type: 'object' },
            plans: {
              type: 'array',
              items: { $ref: '#/components/schemas/PublicApiProductPlan' }
            }
          }
        },
        PublicApiProductPlan: {
          type: 'object',
          required: ['id', 'name', 'description', 'cpu', 'memory', 'disk', 'price', 'setupFee', 'billingCycle', 'isSoldOut'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            cpu: { type: 'integer' },
            memory: { type: 'integer' },
            disk: { type: 'integer' },
            price: { type: 'number' },
            setupFee: { type: 'number' },
            billingCycle: { type: 'string' },
            isSoldOut: { type: 'boolean' },
            trafficLimit: { type: ['string', 'null'] },
            trafficLimitSpeed: { type: ['integer', 'null'] },
            slaGuarantee: { type: ['number', 'null'] }
          }
        },
        PublicApiService: {
          type: 'object',
          required: ['id', 'name', 'status', 'image', 'resources', 'network', 'limits', 'billing', 'createdAt', 'updatedAt'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            status: { type: 'string' },
            image: { type: 'string' },
            resources: {
              type: 'object',
              required: ['cpu', 'memory', 'disk'],
              properties: {
                cpu: { type: 'integer' },
                memory: { type: 'integer' },
                disk: { type: 'integer' }
              }
            },
            network: {
              type: 'object',
              required: ['mode', 'ipv4', 'ipv6'],
              properties: {
                mode: { type: 'string' },
                ipv4: { type: ['string', 'null'] },
                ipv6: { type: ['string', 'null'] }
              }
            },
            limits: {
              type: 'object',
              required: ['ports', 'snapshots', 'backups', 'sites', 'monthlyTrafficLimit', 'monthlyTrafficUsed', 'trafficStatus'],
              properties: {
                ports: { type: ['integer', 'null'] },
                snapshots: { type: ['integer', 'null'] },
                backups: { type: ['integer', 'null'] },
                sites: { type: ['integer', 'null'] },
                monthlyTrafficLimit: { type: ['string', 'null'] },
                monthlyTrafficUsed: { type: ['string', 'null'] },
                trafficStatus: { type: 'string' }
              }
            },
            billing: {
              type: 'object',
              required: ['expiresAt', 'suspendedAt', 'suspendReason', 'billingPrice', 'billingCycle', 'autoRenew', 'plan'],
              properties: {
                expiresAt: { type: ['string', 'null'], format: 'date-time' },
                suspendedAt: { type: ['string', 'null'], format: 'date-time' },
                suspendReason: { type: ['string', 'null'] },
                billingPrice: { type: ['number', 'null'] },
                billingCycle: { type: ['integer', 'null'] },
                autoRenew: { type: 'boolean' },
                plan: { type: ['object', 'null'] }
              }
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        PublicApiServiceIncluded: {
          type: 'object',
          properties: {
            products: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name'],
                properties: {
                  id: { type: 'integer' },
                  name: { type: 'string' }
                }
              }
            },
            plans: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name', 'billingCycle', 'price', 'productId'],
                properties: {
                  id: { type: 'integer' },
                  name: { type: 'string' },
                  billingCycle: { type: ['integer', 'null'] },
                  price: { type: 'number' },
                  productId: { type: ['integer', 'null'] }
                }
              }
            }
          }
        },
        PublicApiServiceActionRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['start', 'stop', 'restart'] }
          }
        },
        PublicApiServiceActionResult: {
          type: 'object',
          required: ['serviceId', 'action', 'taskId', 'taskType', 'status'],
          properties: {
            serviceId: { type: 'integer' },
            action: { type: 'string', enum: ['start', 'stop', 'restart'] },
            taskId: { type: 'integer' },
            taskType: { type: 'string', enum: ['start', 'stop', 'restart'] },
            status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] }
          }
        },
        PublicApiServiceRenewRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['months'],
          properties: {
            months: { type: 'integer', minimum: 1, maximum: 24 }
          }
        },
        PublicApiServiceRenewResult: {
          type: 'object',
          required: ['serviceId', 'months', 'amount', 'discountAmount', 'newExpiresAt'],
          properties: {
            serviceId: { type: 'integer' },
            months: { type: 'integer', minimum: 1, maximum: 24 },
            amount: { type: 'number' },
            discountAmount: { type: ['number', 'null'] },
            newExpiresAt: { type: 'string', format: 'date-time' }
          }
        },
        PublicApiServiceTask: {
          type: 'object',
          required: ['id', 'serviceId', 'taskType', 'status', 'progress', 'error', 'queuePosition', 'createdAt', 'startedAt', 'finishedAt'],
          properties: {
            id: { type: 'integer' },
            serviceId: { type: 'integer' },
            taskType: { type: 'string', enum: ['start', 'stop', 'restart'] },
            status: { type: 'string', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] },
            progress: { type: ['string', 'null'] },
            error: { type: ['string', 'null'] },
            queuePosition: { type: 'integer', minimum: 0 },
            createdAt: { type: 'string', format: 'date-time' },
            startedAt: { type: ['string', 'null'], format: 'date-time' },
            finishedAt: { type: ['string', 'null'], format: 'date-time' }
          }
        },
        PublicApiOrder: {
          type: 'object',
          required: ['id', 'sourceType', 'sourceId', 'orderNo', 'title', 'status', 'rawStatus', 'amount', 'actualAmount', 'fee', 'paymentMethod', 'tradeNo', 'failReason', 'createdAt', 'completedAt', 'expiredAt'],
          properties: {
            id: { type: 'string' },
            sourceType: { type: 'string', enum: ['recharge', 'instance_billing'] },
            sourceId: { type: 'integer' },
            orderNo: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'string' },
            rawStatus: { type: 'string' },
            amount: { type: 'number' },
            actualAmount: { type: ['number', 'null'] },
            fee: { type: 'number' },
            paymentMethod: { type: 'string' },
            tradeNo: { type: ['string', 'null'], description: 'Masked trade number only.' },
            failReason: { type: ['string', 'null'] },
            instance: {
              type: ['object', 'null'],
              required: ['id', 'name', 'status', 'plan'],
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                status: { type: 'string' },
                plan: {
                  type: ['object', 'null'],
                  required: ['id', 'name', 'package'],
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                    package: {
                      type: ['object', 'null'],
                      required: ['id', 'name'],
                      properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' }
                      }
                    }
                  }
                }
              }
            },
            months: { type: ['integer', 'null'] },
            periodStart: { type: 'string', format: 'date-time' },
            periodEnd: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            completedAt: { type: ['string', 'null'], format: 'date-time' },
            expiredAt: { type: ['string', 'null'], format: 'date-time' }
          }
        },
        PublicApiBillingRecord: {
          type: 'object',
          required: ['id', 'orderId', 'serviceId', 'type', 'status', 'amount', 'months', 'periodStart', 'periodEnd', 'remark', 'service', 'createdAt'],
          properties: {
            id: { type: 'integer' },
            orderId: { type: 'string', pattern: '^instance_billing:[1-9]\\d*$' },
            serviceId: { type: 'integer' },
            type: { type: 'string', enum: ['newPurchase', 'renew', 'upgrade', 'downgrade', 'refund', 'transfer_fee'] },
            status: { type: 'string', enum: ['completed', 'refunded'] },
            amount: { type: 'number' },
            months: { type: 'integer' },
            periodStart: { type: 'string', format: 'date-time' },
            periodEnd: { type: 'string', format: 'date-time' },
            remark: { type: ['string', 'null'] },
            service: {
              type: ['object', 'null'],
              required: ['id', 'name', 'status', 'plan'],
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                status: { type: 'string' },
                plan: {
                  type: ['object', 'null'],
                  required: ['id', 'name', 'package'],
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                    package: {
                      type: ['object', 'null'],
                      required: ['id', 'name'],
                      properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' }
                      }
                    }
                  }
                }
              }
            },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        PublicApiTicketAttachment: {
          type: 'object',
          required: ['id', 'filename', 'originalName', 'mimeType', 'sizeBytes', 'thumbnailUrl', 'createdAt'],
          properties: {
            id: { type: 'integer' },
            filename: { type: 'string' },
            originalName: { type: 'string' },
            mimeType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] },
            sizeBytes: { type: 'integer', maximum: 52428800 },
            thumbnailUrl: { type: ['string', 'null'] },
            createdAt: { type: 'string', format: 'date-time' }
          },
          description: 'Safe ticket attachment metadata. Storage provider file IDs and raw provider URLs are never returned by Public API responses.'
        },
        PublicApiTicketSummary: {
          type: 'object',
          required: ['id', 'subject', 'category', 'priority', 'status', 'createdAt', 'updatedAt', 'latestMessage'],
          properties: {
            id: { type: 'integer' },
            subject: { type: 'string' },
            category: { type: 'string' },
            priority: { type: 'string' },
            status: { type: 'string' },
            hostId: { type: ['integer', 'null'] },
            instanceId: { type: ['integer', 'null'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            resolvedAt: { type: ['string', 'null'], format: 'date-time' },
            closedAt: { type: ['string', 'null'], format: 'date-time' },
            latestMessage: { type: ['object', 'null'] }
          }
        },
        PublicApiTicket: {
          allOf: [
            { $ref: '#/components/schemas/PublicApiTicketSummary' },
            {
              type: 'object',
              required: ['messages'],
              properties: {
                messages: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'senderId', 'content', 'isFromOwner', 'createdAt', 'attachments'],
                    properties: {
                      id: { type: 'integer' },
                      senderId: { type: 'integer' },
                      content: { type: 'string' },
                      isFromOwner: { type: 'boolean' },
                      createdAt: { type: 'string', format: 'date-time' },
                      attachments: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PublicApiTicketAttachment' }
                      }
                    }
                  }
                }
              }
            }
          ]
        },
        PublicApiTicketMessage: {
          type: 'object',
          required: ['id', 'ticketId', 'senderId', 'content', 'isFromOwner', 'createdAt', 'attachments'],
          properties: {
            id: { type: 'integer' },
            ticketId: { type: 'integer' },
            senderId: { type: 'integer' },
            content: { type: 'string' },
            isFromOwner: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            attachments: {
              type: 'array',
              maxItems: 6,
              items: { $ref: '#/components/schemas/PublicApiTicketAttachment' },
              description: 'Safe metadata for images attached through multipart/form-data. Provider file IDs are never returned.'
            }
          }
        },
        PublicApiTicketCreateResult: {
          type: 'object',
          required: ['id', 'messageId', 'subject', 'category', 'priority', 'status', 'hostId', 'instanceId', 'attachments'],
          properties: {
            id: { type: 'integer' },
            messageId: { type: 'integer' },
            subject: { type: 'string' },
            category: { type: 'string', enum: ['general', 'billing', 'technical', 'abuse'] },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
            status: { type: 'string', enum: ['open'] },
            hostId: { type: ['integer', 'null'] },
            instanceId: { type: ['integer', 'null'] },
            attachments: {
              type: 'array',
              maxItems: 6,
              items: { $ref: '#/components/schemas/PublicApiTicketAttachment' },
              description: 'Safe metadata for images attached through multipart/form-data. Provider file IDs are never returned.'
            }
          }
        },
        CreatePublicApiTicketRequest: {
          type: 'object',
          required: ['subject', 'content'],
          additionalProperties: false,
          properties: {
            subject: { type: 'string', minLength: 2, maxLength: 200 },
            content: { type: 'string', minLength: 10, maxLength: 5000 },
            category: { type: 'string', enum: ['general', 'billing', 'technical', 'abuse'], default: 'general' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
            instanceId: { type: 'integer', minimum: 1, description: 'Optional current-user instance ID. If omitted, the ticket is routed to administrators.' }
          }
        },
        CreatePublicApiTicketMultipartRequest: {
          type: 'object',
          required: ['subject'],
          additionalProperties: false,
          properties: {
            subject: { type: 'string', minLength: 2, maxLength: 200 },
            content: { type: 'string', maxLength: 5000, description: 'Required to be 10-5000 characters when no images are attached. May be empty when at least one image is attached.' },
            category: { type: 'string', enum: ['general', 'billing', 'technical', 'abuse'], default: 'general' },
            priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
            instanceId: { type: 'integer', minimum: 1, description: 'Optional current-user instance ID. If omitted, the ticket is routed to administrators.' },
            images: {
              type: 'array',
              maxItems: 6,
              items: { type: 'string', format: 'binary' },
              description: 'Optional JPG, PNG, WebP, GIF, or AVIF images. Each image must be no larger than 50MB.'
            }
          }
        },
        CreatePublicApiTicketReplyRequest: {
          type: 'object',
          required: ['content'],
          additionalProperties: false,
          properties: {
            content: {
              type: 'string',
              minLength: 1,
              maxLength: 5000,
              description: 'Plain public reply content. Internal notes, status changes, and target user overrides are not accepted.'
            }
          }
        },
        CreatePublicApiTicketReplyMultipartRequest: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: {
              type: 'string',
              maxLength: 5000,
              description: 'Required to be non-empty when no images are attached. May be empty when at least one image is attached.'
            },
            images: {
              type: 'array',
              maxItems: 6,
              items: { type: 'string', format: 'binary' },
              description: 'Optional JPG, PNG, WebP, GIF, or AVIF images. Each image must be no larger than 50MB.'
            }
          }
        },
        UpdatePublicApiTicketStatusRequest: {
          type: 'object',
          required: ['action'],
          additionalProperties: false,
          properties: {
            action: {
              type: 'string',
              enum: ['close', 'reopen'],
              description: 'close sets the current user ticket to closed; reopen changes a closed current user ticket back to open.'
            }
          }
        },
        PublicApiTicketStatusResult: {
          type: 'object',
          required: ['id', 'status', 'previousStatus', 'resolvedAt', 'closedAt', 'updatedAt'],
          properties: {
            id: { type: 'integer' },
            status: { type: 'string', enum: ['open', 'closed'] },
            previousStatus: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
            resolvedAt: { type: ['string', 'null'], format: 'date-time' },
            closedAt: { type: ['string', 'null'], format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreatePublicApiNotificationRequest: {
          type: 'object',
          required: ['title', 'message'],
          additionalProperties: false,
          properties: {
            title: {
              type: 'string',
              minLength: 1,
              maxLength: 120,
              description: 'Short notification title shown inside the message body.'
            },
            message: {
              type: 'string',
              minLength: 1,
              maxLength: 2000,
              description: 'Plain notification message. The target user is always the authenticated token owner.'
            },
            source: {
              type: 'string',
              maxLength: 80,
              description: 'Optional extension or integration display name.'
            },
            template: {
              type: 'string',
              pattern: '^(flash_sale_reminder|service_action_update|billing_notice|plugin:[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9-]*){2,}:[a-z][a-z0-9_.:-]{0,79})$',
              description: 'Optional controlled template ID. Use a platform template or plugin:<pluginId>:<templateId> for an enabled plugin-declared template. When provided, title/message are generated from scalar variables.'
            },
            variables: {
              type: 'object',
              additionalProperties: {
                oneOf: [
                  { type: 'string', maxLength: 120 },
                  { type: 'number' },
                  { type: 'boolean' }
                ]
              },
              maxProperties: 10,
              description: 'Template variables. Keys must be identifier-like names. Objects, arrays, and long values are rejected.'
            }
          }
        },
        PublicApiNotification: {
          type: 'object',
          required: ['id', 'eventType', 'title', 'content', 'isRead', 'createdAt'],
          properties: {
            id: { type: 'integer' },
            eventType: { type: 'string' },
            title: { type: 'string' },
            content: { type: 'string' },
            isRead: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        PublicApiUnreadNotificationCount: {
          type: 'object',
          required: ['count'],
          properties: {
            count: { type: 'integer', minimum: 0 }
          }
        },
        PublicApiNotificationResult: {
          type: 'object',
          required: ['userId', 'title', 'template', 'source', 'sent', 'failed'],
          properties: {
            userId: { type: 'integer' },
            title: { type: 'string' },
            template: { type: ['string', 'null'], enum: ['flash_sale_reminder', 'service_action_update', 'billing_notice', null] },
            source: { type: 'string' },
            sent: { type: 'integer', minimum: 0 },
            failed: { type: 'integer', minimum: 0 }
          }
        },
        PublicPluginActionDescriptor: {
          type: 'object',
          required: ['name', 'method', 'path', 'runtime', 'scopes', 'idempotency', 'rateLimit', 'requestSchema', 'responseSchema'],
          properties: {
            name: { type: 'string' },
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
            path: { type: 'string' },
            runtime: { type: 'string', enum: ['webhook'] },
            scopes: { type: 'array', items: { type: 'string' } },
            idempotency: { type: 'string', enum: ['none', 'optional', 'required'] },
            rateLimit: { type: 'string', enum: ['normal', 'strict'] },
            requestSchema: { type: ['object', 'null'] },
            responseSchema: { type: ['object', 'null'] }
          }
        },
        PublicPluginActionCatalogItem: {
          type: 'object',
          required: ['pluginId', 'name', 'version', 'description', 'author', 'homepage', 'actionCount', 'actions'],
          properties: {
            pluginId: { type: 'string' },
            name: { type: 'string' },
            version: { type: 'string' },
            description: { type: ['string', 'null'] },
            author: { type: ['string', 'null'] },
            homepage: { type: ['string', 'null'] },
            actionCount: { type: 'integer', minimum: 1 },
            actions: {
              type: 'array',
              items: { $ref: '#/components/schemas/PublicPluginActionDescriptor' }
            }
          }
        },
        PublicPluginActionCatalog: {
          type: 'object',
          required: ['pluginId', 'name', 'version', 'description', 'actions'],
          properties: {
            pluginId: { type: 'string' },
            name: { type: 'string' },
            version: { type: 'string' },
            description: { type: ['string', 'null'] },
            actions: {
              type: 'array',
              items: { $ref: '#/components/schemas/PublicPluginActionDescriptor' }
            }
          }
        },
        DispatchPublicPluginActionRequest: {
          type: 'object',
          additionalProperties: true,
          properties: {
            idempotencyKey: {
              type: 'string',
              description: 'Optional idempotency key passed to the plugin webhook runtime.'
            },
            payload: {
              description: 'JSON payload forwarded to the plugin action. If omitted, the whole request body is forwarded.'
            }
          }
        },
        PublicPluginActionResult: {
          type: 'object',
          required: ['pluginId', 'action', 'runtime', 'status', 'statusCode', 'requestId', 'result'],
          properties: {
            pluginId: { type: 'string' },
            action: { type: 'string' },
            runtime: { type: 'string', enum: ['webhook'] },
            status: { type: 'string', enum: ['success'] },
            statusCode: { type: 'integer' },
            requestId: { type: 'string' },
            result: {}
          }
        },
        PublicApiToken: {
          type: 'object',
          required: ['id', 'name', 'tokenPrefix', 'scopes', 'lastUsedAt', 'revokedAt', 'expiresAt', 'createdAt', 'updatedAt'],
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            tokenPrefix: { type: 'string' },
            scopes: {
              type: 'array',
              items: { $ref: '#/components/schemas/PublicApiScope' }
            },
            lastUsedAt: { type: ['string', 'null'], format: 'date-time' },
            revokedAt: { type: ['string', 'null'], format: 'date-time' },
            expiresAt: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        CreatePublicApiTokenRequest: {
          type: 'object',
          required: ['name', 'scopes'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80 },
            scopes: {
              type: 'array',
              minItems: 1,
              maxItems: 24,
              uniqueItems: true,
              items: { $ref: '#/components/schemas/PublicApiScope' }
            },
            expiresAt: { type: ['string', 'null'], format: 'date-time' }
          },
          additionalProperties: false
        },
        CreatePublicApiTokenResponse: {
          type: 'object',
          required: ['token', 'apiToken'],
          properties: {
            token: { type: 'string', pattern: '^pat_' },
            apiToken: { $ref: '#/components/schemas/PublicApiToken' }
          }
        },
        OAuthTokenRequest: {
          type: 'object',
          required: ['grantType', 'clientId', 'clientSecret'],
          properties: {
            grantType: { type: 'string', enum: ['authorization_code', 'refresh_token'] },
            clientId: { type: 'string', pattern: '^pocli_' },
            clientSecret: { type: 'string', pattern: '^posec_' },
            code: { type: 'string', pattern: '^poc_' },
            redirectUri: { type: 'string', format: 'uri' },
            refreshToken: { type: 'string', pattern: '^por_' }
          },
          additionalProperties: false
        },
        OAuthTokenResponse: {
          type: 'object',
          required: ['access_token', 'refresh_token', 'token_type', 'expires_in', 'refresh_token_expires_in', 'scope'],
          properties: {
            access_token: { type: 'string', pattern: '^poa_' },
            refresh_token: { type: 'string', pattern: '^por_' },
            token_type: { type: 'string', enum: ['Bearer'] },
            expires_in: { type: 'integer', minimum: 1 },
            refresh_token_expires_in: { type: 'integer', minimum: 1 },
            scope: { type: 'string' }
          }
        },
        OAuthConsentResponse: {
          type: 'object',
          required: ['app', 'requestedScopes', 'scopeMetadata', 'existingScopes', 'consentRequired', 'request'],
          properties: {
            app: {
              type: 'object',
              required: ['id', 'name', 'clientId'],
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                clientId: { type: 'string', pattern: '^pocli_' }
              }
            },
            requestedScopes: { type: 'array', items: { $ref: '#/components/schemas/PublicApiScope' } },
            scopeMetadata: { type: 'array', items: { $ref: '#/components/schemas/OAuthScopeMetadata' } },
            existingScopes: { type: 'array', items: { $ref: '#/components/schemas/PublicApiScope' } },
            consentRequired: { type: 'boolean' },
            request: { type: 'object' }
          }
        },
        OAuthAuthorizeConfirmRequest: {
          type: 'object',
          required: ['responseType', 'clientId', 'redirectUri', 'scope', 'confirmed'],
          properties: {
            responseType: { type: 'string', enum: ['code'] },
            clientId: { type: 'string', pattern: '^pocli_' },
            redirectUri: { type: 'string', format: 'uri' },
            scope: { type: 'string' },
            state: { type: ['string', 'null'] },
            confirmed: { type: 'boolean' }
          },
          additionalProperties: false
        },
        OAuthAuthorizeResponse: {
          type: 'object',
          required: ['redirectTo'],
          properties: {
            redirectTo: { type: 'string', format: 'uri' },
            expiresIn: { type: 'integer', minimum: 1 }
          }
        },
        OAuthAuthorization: {
          type: 'object',
          required: ['id', 'app', 'scopes', 'active', 'lastAuthorizedAt', 'revokedAt', 'createdAt', 'updatedAt'],
          properties: {
            id: { type: 'integer' },
            app: {
              type: 'object',
              required: ['id', 'name', 'clientId', 'enabled'],
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                clientId: { type: 'string', pattern: '^pocli_' },
                enabled: { type: 'boolean' }
              }
            },
            scopes: { type: 'array', items: { $ref: '#/components/schemas/PublicApiScope' } },
            active: { type: 'boolean' },
            lastAuthorizedAt: { type: 'string', format: 'date-time' },
            revokedAt: { type: ['string', 'null'], format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
            code: { type: 'string' },
            details: {
              type: 'object',
              additionalProperties: true,
              description: 'Optional machine-readable details for conflict, validation, rate-limit, or workflow lock errors.'
            }
          }
        }
      },
      responses: {
        BadRequest: {
          description: 'Invalid request.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        Unauthorized: {
          description: 'Authentication failed.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        Forbidden: {
          description: 'Missing permission or scope.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        NotFound: {
          description: 'Resource not found.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        Conflict: {
          description: 'Resource state conflict.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        },
        TooManyRequests: {
          description: 'Rate or pending request limit exceeded.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' }
            }
          }
        }
      }
    }
  }
}
