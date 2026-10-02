# How to test REST APIs inside VS Code

Switching between your editor and a separate API client costs more than it seems: you copy a URL out of the code, paste a token from a `.env` file, send, then copy the JSON response back to write a type or a test. Doing all of this inside VS Code keeps the code, the request and the response next to each other.

This guide uses the free REST API Client in [DevSnip Pro](https://marketplace.visualstudio.com/items?itemName=sayaib.hue-console). The habits it describes work with any client.

## 1. Send the first request

1. Run **DevSnip Pro: REST API Client** from the Command Palette (<kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>).
2. Leave the method on `GET`, enter `https://jsonplaceholder.typicode.com/todos/1` and press <kbd>Enter</kbd>.
3. The response panel shows the status, time and size, formatted JSON you can search, and the headers and cookies.

If you already have a request as a cURL command (from browser dev tools: *Copy as cURL*), paste it into the URL bar instead. The method, headers and body are imported.

## 2. Stop hard-coding hosts and tokens

Create an **environment** for each target, such as `local` and `staging`, with variables like `baseUrl` and `token`. Then write requests as:

```
GET {{baseUrl}}/users/42
Authorization: Bearer {{token}}
```

Switching the environment reruns the same request against another server, and secrets stay out of the request you save.

## 3. Save what you will run again

Save requests into **collections**, grouped in folders that mirror your API (`auth/`, `users/`, `billing/`). History keeps everything you sent, with credential-looking URL values redacted. Saved requests act as living documentation for the next person on the project.

## 4. Check the response, not just the status

A `200` with the wrong body is still a bug. Things to look at for every endpoint you touch:

- **Shape:** are fields present, typed as expected, and named consistently?
- **Errors:** send a bad payload on purpose. Is the status `4xx` with a useful message, or a `500` with a stack trace?
- **Headers:** `Content-Type`, caching headers, and CORS headers if a browser will call it.
- **Time:** an endpoint that takes 900 ms locally will not be faster in production.

In DevSnip Pro you can turn these checks into **assertions** that run on every send, chain requests (log in, create, then verify), and run a request many times to see latency percentiles. These are advanced tools, paid for with points earned by using the extension.

## 5. Turn the request into code

When the request works, **generate code** for it in JavaScript, Python, Go, Java or C#, or export it as cURL for a README or a bug report. To get types from the response, open **JSON to Types** from the Tools sidebar. It writes TypeScript, Zod, Pydantic, Kotlin, Swift, Dart, Java, Go or JSON Schema.

## 6. Check it is safe before you ship

Run **DevSnip Pro: Endpoint Security Scan** against a URL you are authorised to test. It reports TLS, HSTS, security headers, CSP, CORS and cookie settings, each with a fix. See [VS Code security testing tools](vscode-security-testing-tools.md).

## Summary

| Step | Why it matters |
| :--- | :--- |
| Environments | One request, many servers; no secrets in saved requests |
| Collections | Repeatable checks and shared knowledge |
| Look past the status code | Catches contract and error-handling bugs |
| Generate code and types | No hand-copying of URLs and JSON |
| Security scan | Misconfigured headers are cheap to fix before release |
