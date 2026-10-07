# How to test a GraphQL API in VS Code

**Short answer:** a GraphQL request is an HTTP `POST` with a JSON body holding the query, its variables and, optionally, an operation name. Any REST client that understands GraphQL can send it. This guide uses the free REST API Client in [DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console), which has a GraphQL mode with separate query, variables and operation-name fields.

## 1. Switch the client to GraphQL

1. Run **DevSnip Pro: REST API Client** from the Command Palette (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>).
2. Switch the protocol from **HTTP** to **GraphQL** (next to the request name). The **Body** tab is replaced by a **Query** tab.
3. Set the method to **POST** and enter the endpoint, for example `https://countries.trevorblades.com/` (a public demo API) or `{{baseUrl}}/graphql`.

If the method is `GET`, the client warns that the query will not be sent and offers **Use POST**.

## 2. Write the query and variables

In the **Query** field:

```graphql
query GetCountry($code: ID!) {
  country(code: $code) {
    name
    capital
    currency
  }
}
```

In **Variables (JSON)**:

```json
{ "code": "DE" }
```

The variables field is checked as you type, so invalid JSON is flagged before you send. Fill in **Operation name** (`GetCountry`) when the document contains more than one operation.

## 3. Send and read the response

Press <kbd>Ctrl/Cmd</kbd>+<kbd>Enter</kbd> or **Send**. GraphQL servers usually answer `200 OK` even when the query fails, so read the body:

- `data` holds the result;
- `errors` lists problems with a message and a path. A response can contain both, which means a partial result.

## 4. Add auth and environments

GraphQL APIs use the same auth as REST ones. Put the token in an **environment** variable and set **Bearer** auth to `{{token}}`; switch environments to run the same query against local and staging. Save the request to a **collection** so the query becomes documentation.

## 5. Format queries and generate types

Open **GraphQL Formatter & Types** from the **Backend & API** section of the Tools sidebar:

- **Query: format & request** formats or minifies a query, lists its operations and variables, and builds the JSON request body, a cURL command and a `fetch` call. It flags undefined or unused fragments and unnamed operations.
- **Schema (SDL) → TypeScript** turns a schema into TypeScript types. For fully typed operations, GraphQL Code Generator goes further.

## Limits worth knowing

- There is no schema explorer or autocomplete from introspection; write the query yourself or paste it from your codebase.
- GraphQL subscriptions over WebSocket are not a dedicated mode. The client's WebSocket tool is a points-priced advanced feature.

---

**Try it:** [Install DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console) (free, no account) or run `code --install-extension sayaib.hue-console`.

Related: [How to test REST APIs in VS Code](test-rest-apis-in-vscode.md) · [Free Postman alternative in VS Code](postman-alternative-in-vscode.md) · [All guides](README.md)
