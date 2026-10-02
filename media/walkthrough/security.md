# Security scans

The **Security** panel has four scans:

| Scan | What it checks |
| :--- | :--- |
| **Workspace audit** | Hard-coded secrets, injection risks, weak cryptography and unsafe configuration in your code. |
| **Cloud & container** | Terraform, Kubernetes, Docker Compose, Dockerfiles and CI workflows. |
| **Dependencies & config** | Your dependency manifests and project configuration. |
| **Endpoint scan** | TLS, HSTS, security headers, CORS and cookies of a URL you own or are authorised to test. |

Every finding explains the evidence it was based on and how to fix it. Workspace scans run locally; nothing is uploaded.
