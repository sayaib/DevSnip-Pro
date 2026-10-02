# VS Code tools for API development

API development touches more than the request and the response. Around every endpoint there is a spec, types, auth, CORS, a database, logs and deployment config. This is a map of the tools that help at each stage inside VS Code. All of them are part of [DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console) and can be found from the Tools sidebar search.

## Design and contracts

| Tool | Use it to |
| :--- | :--- |
| **OpenAPI / Swagger Toolkit** | Lint a spec, list endpoints, generate TypeScript types, a fetch client and cURL |
| **GraphQL Formatter & Types** | Format queries, build request bodies, turn SDL into TypeScript |
| **JSON to Types** | Generate TypeScript, Zod, Pydantic, Go, Kotlin, Swift, Dart, Java or JSON Schema from a sample |
| **JSON Schema Validator** | Validate a payload against a schema with each violation's path, or infer a schema |

## Building

| Tool | Use it to |
| :--- | :--- |
| **API Resource Scaffolder** | Generate a validated CRUD API for Express, NestJS, Next.js or Fastify |
| **Mock Data Generator** | Create seeded fake records as JSON, CSV or SQL |
| **Database Client** | Browse and edit PostgreSQL, MySQL, SQL Server, SQLite, MongoDB and Redis; run queries |
| **SQL Query Helper** | Write parameterised SELECT, INSERT, UPDATE, UPSERT, DELETE and pagination queries |

## Calling and debugging

| Tool | Use it to |
| :--- | :--- |
| **REST API Client** | Send HTTP, GraphQL and WebSocket requests with environments, collections and history |
| **cURL Converter** | Turn a cURL command into fetch, Axios, Python, Go, Dart, Kotlin, Swift and more |
| **API Response Inspector** | Pretty-print a raw HTTP response with status, headers, paging and caching hints |
| **URL & Query String Tool** | Parse and build URLs, convert query strings ↔ JSON |
| **CORS Builder & Debugger** | Configure CORS for Express, NestJS, Next.js and nginx, and fix CORS errors |
| **Log Analyzer & Formatter** | Summarise app, JSON and access logs: errors, status codes, slow requests |

## Auth and security

| Tool | Use it to |
| :--- | :--- |
| **JWT Decoder & Signer** | Decode, verify and sign test tokens locally |
| **OAuth 2.0 & PKCE** | Build PKCE values, authorization URLs and token requests |
| **Hash, HMAC & Webhook Signatures** | Verify webhook signatures |
| **CSP & Security Headers** | Build a Content-Security-Policy and the other security headers |
| **Endpoint Security Scan** | Check a live endpoint's TLS, HSTS, headers, CSP, CORS and cookies |
| **Workspace Security Audit** | Find hard-coded secrets and injection risks in the code |

## Shipping

| Tool | Use it to |
| :--- | :--- |
| **Dockerfile Generator & Linter**, **Docker Compose** | Package the service |
| **CI Pipeline**, **Cloud Deploy Workflow** | Build, test and deploy on every push |
| **Health Check Endpoints**, **Observability Starter** | Make the service observable from day one |
| **Nginx**, **Cache-Control Builder** | Put it behind a proxy with sensible caching |

## Getting started

Install DevSnip Pro from the Extensions view, open its icon in the Activity Bar, and follow the five-step **Get started** card: send a request, try an AI tool, run a security scan, connect a database and pick a theme. Each step takes about a minute.

Related guides: [How to test REST APIs inside VS Code](test-rest-apis-in-vscode.md) · [How to build and test APIs faster](build-and-test-apis-faster.md)
