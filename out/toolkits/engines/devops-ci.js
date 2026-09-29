"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityWorkflow = exports.validFargate = exports.deployWorkflow = exports.jenkinsfile = exports.gitlabCi = exports.githubActionsCi = void 0;
const yaml_1 = __importDefault(require("yaml"));
const types_1 = require("../types");
function commands(o) {
    const pm = o.packageManager;
    switch (o.stack) {
        case "node":
        case "static": {
            const install = pm === "pnpm" ? "pnpm install --frozen-lockfile" : pm === "yarn" ? "yarn install --frozen-lockfile" : "npm ci";
            const run = (script) => pm === "npm" ? `npm run ${script} --if-present` : `${pm} run --if-present ${script}`;
            return { install: [install], lint: run("lint"), test: pm === "npm" ? "npm test --if-present" : run("test"), build: run("build"), image: `node:${o.version || "22"}`, cacheDir: pm === "pnpm" ? ".pnpm-store" : pm === "yarn" ? ".yarn-cache" : ".npm" };
        }
        case "python":
            return { install: ["python -m pip install --upgrade pip", "if [ -f requirements.txt ]; then pip install -r requirements.txt; else pip install -e .; fi", "pip install pytest ruff"], lint: "ruff check .", test: "pytest -q", build: "python -m compileall -q .", image: `python:${o.version || "3.12"}-slim`, cacheDir: ".cache/pip" };
        case "go":
            return { install: ["go mod download"], lint: "go vet ./...", test: "go test -race ./...", build: "go build ./...", image: `golang:${o.version || "1.23"}`, cacheDir: ".go-cache" };
        case "java-maven":
            return { install: [], lint: undefined, test: "mvn -B -ntp verify", build: "mvn -B -ntp -DskipTests package", image: `maven:3-eclipse-temurin-${o.version || "21"}`, cacheDir: ".m2/repository" };
        case "java-gradle":
            return { install: [], lint: undefined, test: "./gradlew test --no-daemon", build: "./gradlew build -x test --no-daemon", image: `gradle:jdk${o.version || "21"}`, cacheDir: ".gradle" };
    }
}
function versions(o) {
    const extra = o.matrix.split(",").map(v => v.trim()).filter(Boolean);
    const all = [o.version || defaultVersion(o.stack), ...extra];
    for (const v of all)
        if (!/^[\w.-]+$/.test(v))
            throw new types_1.ToolInputError(`"${v}" is not a valid version.`);
    return [...new Set(all)];
}
function defaultVersion(stack) {
    return stack === "python" ? "3.12" : stack === "go" ? "1.23" : stack.startsWith("java") ? "21" : "22";
}
function setupSteps(o, versionExpr) {
    switch (o.stack) {
        case "node":
        case "static":
            return [
                ...(o.packageManager === "pnpm" ? ["      # Reads the pnpm version from \"packageManager\" in package.json; otherwise add `with: { version: 9 }`.", "      - uses: pnpm/action-setup@v4"] : []),
                "      - uses: actions/setup-node@v4",
                "        with:",
                `          node-version: ${versionExpr}`,
                `          cache: ${o.packageManager}`
            ];
        case "python":
            return ["      - uses: actions/setup-python@v5", "        with:", `          python-version: ${versionExpr}`, "          cache: pip"];
        case "go":
            return ["      - uses: actions/setup-go@v5", "        with:", `          go-version: ${versionExpr}`, "          cache: true"];
        case "java-maven":
            return ["      - uses: actions/setup-java@v4", "        with:", "          distribution: temurin", `          java-version: ${versionExpr}`, "          cache: maven"];
        case "java-gradle":
            return ["      - uses: actions/setup-java@v4", "        with:", "          distribution: temurin", `          java-version: ${versionExpr}`, "      - uses: gradle/actions/setup-gradle@v4"];
    }
}
const q = (v) => JSON.stringify(v);
function githubActionsCi(o) {
    const c = commands(o);
    const vs = versions(o);
    const matrix = vs.length > 1;
    const versionExpr = matrix ? "${{ matrix.version }}" : q(vs[0]);
    const branch = o.branch.trim() || "main";
    const steps = [
        "      - uses: actions/checkout@v4",
        ...setupSteps(o, versionExpr),
        ...c.install.map(cmd => `      - run: ${/[:#'"\[\]{}]|^[!&*|>%@`]/.test(cmd) ? q(cmd) : cmd}`),
        ...(o.lint && c.lint ? [`      - name: Lint\n        run: ${c.lint}`] : []),
        ...(o.test && c.test ? [`      - name: Test\n        run: ${c.test}`] : []),
        ...(o.build && c.build ? [`      - name: Build\n        run: ${c.build}`] : [])
    ];
    return `name: CI

on:
  push:
    branches: [${branch}]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
${matrix ? `    strategy:
      fail-fast: false
      matrix:
        version: [${vs.map(q).join(", ")}]
` : ""}    steps:
${steps.join("\n")}
`;
}
exports.githubActionsCi = githubActionsCi;
function gitlabCi(o) {
    const c = commands(o);
    const vs = versions(o);
    const js = o.stack === "node" || o.stack === "static";
    const lockFile = js ? (o.packageManager === "pnpm" ? "pnpm-lock.yaml" : o.packageManager === "yarn" ? "yarn.lock" : "package-lock.json")
        : o.stack === "python" ? "requirements.txt" : o.stack === "go" ? "go.sum" : o.stack === "java-maven" ? "pom.xml" : "build.gradle";
    const variables = {};
    if (js && o.packageManager === "npm")
        variables.npm_config_cache = "$CI_PROJECT_DIR/.npm";
    if (js && o.packageManager === "yarn")
        variables.YARN_CACHE_FOLDER = "$CI_PROJECT_DIR/.yarn-cache";
    if (o.stack === "python")
        variables.PIP_CACHE_DIR = "$CI_PROJECT_DIR/.cache/pip";
    if (o.stack === "go")
        variables.GOPATH = "$CI_PROJECT_DIR/.go-cache";
    if (o.stack === "java-maven")
        variables.MAVEN_OPTS = "-Dmaven.repo.local=$CI_PROJECT_DIR/.m2/repository";
    if (o.stack === "java-gradle")
        variables.GRADLE_USER_HOME = "$CI_PROJECT_DIR/.gradle";
    const beforeScript = [
        ...(js && o.packageManager === "pnpm" ? ["corepack enable", "pnpm config set store-dir .pnpm-store"] : []),
        ...c.install
    ];
    const doc = {
        stages: ["test", "build"],
        workflow: { rules: [{ if: "$CI_PIPELINE_SOURCE == \"merge_request_event\"" }, { if: `$CI_COMMIT_BRANCH == "${o.branch.trim() || "main"}"` }] },
        default: {
            image: c.image,
            interruptible: true,
            cache: { key: { files: [lockFile] }, paths: [`${c.cacheDir}/`] },
            ...(beforeScript.length ? { before_script: beforeScript } : {})
        },
        ...(Object.keys(variables).length ? { variables } : {})
    };
    if (o.lint && c.lint)
        doc.lint = { stage: "test", script: [c.lint] };
    if (o.test && c.test) {
        doc.test = { stage: "test", script: [c.test] };
        if (vs.length > 1) {
            doc.test.image = `${c.image.split(":")[0]}:${o.stack === "python" ? "${VERSION}-slim" : o.stack === "java-maven" ? "3-eclipse-temurin-${VERSION}" : o.stack === "java-gradle" ? "jdk${VERSION}" : "${VERSION}"}`;
            doc.test.parallel = { matrix: [{ VERSION: vs }] };
        }
    }
    if (o.build && c.build) {
        doc.build = { stage: "build", script: [c.build] };
        if (js)
            doc.build.artifacts = { paths: ["dist/"], expire_in: "1 week" };
    }
    return yaml_1.default.stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}
exports.gitlabCi = gitlabCi;
function jenkinsfile(o) {
    const c = commands(o);
    const stage = (name, cmd) => `        stage('${name}') {\n            steps {\n                sh '${cmd.replace(/'/g, "\\'")}'\n            }\n        }`;
    // Jenkins runs the container as the agent user, so "corepack enable" (which writes to /usr/local/bin) fails; call pnpm through corepack instead.
    const viaCorepack = (cmd) => cmd && o.packageManager === "pnpm" && (o.stack === "node" || o.stack === "static") ? cmd.replace(/^pnpm /, "corepack pnpm ") : cmd;
    const install = c.install.map(cmd => viaCorepack(cmd));
    const stages = [
        ...(install.length ? [stage("Install", install.join(" && "))] : []),
        ...(o.lint && c.lint ? [stage("Lint", viaCorepack(c.lint))] : []),
        ...(o.test && c.test ? [stage("Test", viaCorepack(c.test))] : []),
        ...(o.build && c.build ? [stage("Build", viaCorepack(c.build))] : [])
    ];
    const report = o.stack === "java-maven" ? "junit allowEmptyResults: true, testResults: 'target/surefire-reports/*.xml'" : o.stack === "java-gradle" ? "junit allowEmptyResults: true, testResults: 'build/test-results/test/*.xml'" : "echo 'Pipeline finished'";
    return `// Requires the Docker Pipeline plugin on the Jenkins agent.
pipeline {
    agent {
        docker {
            image '${c.image}'
            reuseNode true
        }
    }
    options {
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds(abortPrevious: true)
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }
    environment {
        HOME = "\${WORKSPACE}"
    }
    stages {
${stages.join("\n")}
    }
    post {
        always {
            ${report}
        }
    }
}
`;
}
exports.jenkinsfile = jenkinsfile;
const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "app";
function deployWorkflow(o) {
    const name = slug(o.appName);
    const branch = o.branch.trim() || "main";
    const trigger = `on:
  push:
    branches: [${branch}]
    tags: ["v*"]
  workflow_dispatch:
`;
    switch (o.target) {
        case "ghcr":
        case "dockerhub": {
            const ghcr = o.target === "ghcr";
            return {
                files: [{ path: ".github/workflows/docker-publish.yml", language: "yaml", content: `name: Publish image

${trigger}
permissions:
  contents: read
${ghcr ? "  packages: write\n" : ""}
env:
  IMAGE: ${ghcr ? "ghcr.io/${{ github.repository }}" : `\${{ vars.DOCKERHUB_USERNAME }}/${name}`}

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
${ghcr ? "          registry: ghcr.io\n          username: ${{ github.actor }}\n          password: ${{ secrets.GITHUB_TOKEN }}" : "          username: ${{ vars.DOCKERHUB_USERNAME }}\n          password: ${{ secrets.DOCKERHUB_TOKEN }}"}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: \${{ env.IMAGE }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,format=short
      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
` }],
                setup: ghcr
                    ? ["No secrets needed: the workflow uses the built-in GITHUB_TOKEN.", "After the first push, set the package visibility in GitHub → Packages if it should be public."]
                    : ["Create a Docker Hub access token (Account settings → Personal access tokens, Read & Write).", "In the GitHub repository: Settings → Secrets and variables → Actions: add variable DOCKERHUB_USERNAME and secret DOCKERHUB_TOKEN."]
            };
        }
        case "aws-ecs": {
            const taskDef = {
                family: name,
                networkMode: "awsvpc",
                requiresCompatibilities: ["FARGATE"],
                cpu: String(o.cpu),
                memory: String(o.memory),
                runtimePlatform: { cpuArchitecture: "X86_64", operatingSystemFamily: "LINUX" },
                executionRoleArn: "arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole",
                taskRoleArn: `arn:aws:iam::ACCOUNT_ID:role/${name}-task`,
                containerDefinitions: [{
                        name,
                        image: "PLACEHOLDER (replaced by the workflow)",
                        essential: true,
                        portMappings: [{ containerPort: o.port, protocol: "tcp" }],
                        environment: [{ name: "PORT", value: String(o.port) }],
                        secrets: [{ name: "DATABASE_URL", valueFrom: `arn:aws:ssm:${o.region}:ACCOUNT_ID:parameter/${name}/DATABASE_URL` }],
                        logConfiguration: { logDriver: "awslogs", options: { "awslogs-group": `/ecs/${name}`, "awslogs-region": o.region, "awslogs-stream-prefix": name, "awslogs-create-group": "true" } },
                        ...(o.healthPath.trim() ? { healthCheck: { command: ["CMD-SHELL", `wget -qO- http://127.0.0.1:${o.port}${o.healthPath.trim()} || exit 1`], interval: 30, timeout: 5, retries: 3, startPeriod: 30 } } : {})
                    }]
            };
            if (!validFargate(o.cpu, o.memory))
                throw new types_1.ToolInputError(`${o.cpu} CPU units with ${o.memory} MiB is not a valid Fargate size. Examples: 256/512, 512/1024, 1024/2048, 2048/4096, 4096/8192.`);
            return {
                files: [
                    { path: `.aws/task-definition.json`, language: "json", content: JSON.stringify(taskDef, null, 2) + "\n" },
                    { path: ".github/workflows/deploy-ecs.yml", language: "yaml", content: `name: Deploy to Amazon ECS

${trigger}
permissions:
  contents: read
  id-token: write   # OIDC: no long-lived AWS keys in GitHub

env:
  AWS_REGION: ${o.region}
  ECR_REPOSITORY: ${name}
  ECS_CLUSTER: ${name}-cluster
  ECS_SERVICE: ${name}
  CONTAINER_NAME: ${name}

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: \${{ env.AWS_REGION }}
      - id: ecr
        uses: aws-actions/amazon-ecr-login@v2
      - name: Build and push image
        id: build
        env:
          IMAGE: \${{ steps.ecr.outputs.registry }}/\${{ env.ECR_REPOSITORY }}:\${{ github.sha }}
        run: |
          docker build -t "$IMAGE" .
          docker push "$IMAGE"
          echo "image=$IMAGE" >> "$GITHUB_OUTPUT"
      - id: render
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: .aws/task-definition.json
          container-name: \${{ env.CONTAINER_NAME }}
          image: \${{ steps.build.outputs.image }}
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v2
        with:
          task-definition: \${{ steps.render.outputs.task-definition }}
          service: \${{ env.ECS_SERVICE }}
          cluster: \${{ env.ECS_CLUSTER }}
          wait-for-service-stability: true
` }
                ],
                setup: [
                    `Create the ECR repository "${name}", the ECS cluster "${name}-cluster" and service "${name}" (Fargate) in ${o.region}.`,
                    "Create an IAM OIDC identity provider for token.actions.githubusercontent.com and a role GitHub can assume, restricted to this repository.",
                    "Give that role ECR push, ecs:RegisterTaskDefinition, ecs:UpdateService, ecs:DescribeServices and iam:PassRole on the task roles.",
                    "GitHub → Settings → Secrets and variables → Actions → Variables: AWS_DEPLOY_ROLE_ARN.",
                    "Replace ACCOUNT_ID in .aws/task-definition.json; store secrets in SSM Parameter Store and list them under \"secrets\".",
                    "Create a GitHub environment named \"production\" to require approvals before deploys."
                ]
            };
        }
        case "aws-s3-static":
            return {
                files: [{ path: ".github/workflows/deploy-s3.yml", language: "yaml", content: `name: Deploy static site to S3

${trigger}
permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "${o.version || "22"}"
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.AWS_DEPLOY_ROLE_ARN }}
          aws-region: ${o.region}
      - name: Upload (hashed assets cached for a year, HTML revalidated)
        run: |
          aws s3 sync dist/ "s3://\${{ vars.S3_BUCKET }}" --delete --cache-control "public,max-age=31536000,immutable" --exclude "*.html"
          aws s3 sync dist/ "s3://\${{ vars.S3_BUCKET }}" --delete --cache-control "no-cache" --exclude "*" --include "*.html"
      - name: Invalidate CloudFront
        run: aws cloudfront create-invalidation --distribution-id "\${{ vars.CLOUDFRONT_DISTRIBUTION_ID }}" --paths "/*"
` }],
                setup: [
                    "Create a private S3 bucket and a CloudFront distribution with Origin Access Control.",
                    "Create an OIDC deploy role with s3:ListBucket/PutObject/DeleteObject on the bucket and cloudfront:CreateInvalidation.",
                    "GitHub Actions variables: AWS_DEPLOY_ROLE_ARN, S3_BUCKET, CLOUDFRONT_DISTRIBUTION_ID.",
                    "Change dist/ if your build writes somewhere else (build/, out/)."
                ]
            };
        case "azure-container-apps":
            return {
                files: [{ path: ".github/workflows/deploy-container-apps.yml", language: "yaml", content: `name: Deploy to Azure Container Apps

${trigger}
permissions:
  contents: read
  id-token: write   # OIDC federated credential, no client secret

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: \${{ vars.AZURE_CLIENT_ID }}
          tenant-id: \${{ vars.AZURE_TENANT_ID }}
          subscription-id: \${{ vars.AZURE_SUBSCRIPTION_ID }}
      - uses: azure/container-apps-deploy-action@v2
        with:
          appSourcePath: \${{ github.workspace }}
          acrName: \${{ vars.AZURE_ACR_NAME }}
          containerAppName: ${name}
          resourceGroup: \${{ vars.AZURE_RESOURCE_GROUP }}
          imageToBuild: \${{ vars.AZURE_ACR_NAME }}.azurecr.io/${name}:\${{ github.sha }}
          targetPort: ${o.port}
          ingress: external
` }],
                setup: [
                    "Create a resource group, an Azure Container Registry and a Container Apps environment.",
                    "Create an app registration with a federated credential for this repository (Entra ID → App registrations → Certificates & secrets → Federated credentials).",
                    "Grant it Contributor on the resource group and AcrPush on the registry.",
                    "GitHub Actions variables: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID, AZURE_ACR_NAME, AZURE_RESOURCE_GROUP."
                ]
            };
        case "azure-webapp": {
            if (o.stack !== "node" && o.stack !== "python")
                throw new types_1.ToolInputError("Azure Web App code deploys are generated for Node.js and Python. Use Azure Container Apps for other stacks.");
            const node = o.stack === "node";
            return {
                files: [{ path: ".github/workflows/deploy-webapp.yml", language: "yaml", content: `name: Deploy to Azure Web App

${trigger}
permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
${node ? `      - uses: actions/setup-node@v4
        with:
          node-version: "${o.version || "22"}"
          cache: npm
      - run: npm ci
      - run: npm run build --if-present
      - run: npm prune --omit=dev` : `      - uses: actions/setup-python@v5
        with:
          python-version: "${o.version || "3.12"}"
      - run: pip install -r requirements.txt --target=".python_packages/lib/site-packages"`}
      - uses: azure/login@v2
        with:
          client-id: \${{ vars.AZURE_CLIENT_ID }}
          tenant-id: \${{ vars.AZURE_TENANT_ID }}
          subscription-id: \${{ vars.AZURE_SUBSCRIPTION_ID }}
      - uses: azure/webapps-deploy@v3
        with:
          app-name: ${name}
          package: .
` }],
                setup: [
                    `Create an App Service plan and a Linux Web App named "${name}" with the ${node ? "Node" : "Python"} ${o.version} runtime.`,
                    node ? "Set the startup command in Configuration → General settings if it is not \"npm start\"." : "Set the startup command, e.g. gunicorn --bind=0.0.0.0 --timeout 600 app:app. Enable SCM_DO_BUILD_DURING_DEPLOYMENT=false since dependencies are packaged.",
                    "Create an app registration with a federated credential for this repository and grant it Website Contributor on the app.",
                    "GitHub Actions variables: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID."
                ]
            };
        }
    }
}
exports.deployWorkflow = deployWorkflow;
const FARGATE = {
    256: [512, 1024, 2048],
    512: [1024, 2048, 3072, 4096],
    1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
    2048: range(4096, 16384, 1024),
    4096: range(8192, 30720, 1024),
    8192: range(16384, 61440, 4096),
    16384: range(32768, 122880, 8192)
};
function range(from, to, step) {
    const out = [];
    for (let v = from; v <= to; v += step)
        out.push(v);
    return out;
}
function validFargate(cpu, memory) {
    return FARGATE[cpu]?.includes(memory) ?? false;
}
exports.validFargate = validFargate;
function securityWorkflow(stack) {
    const language = stack === "python" ? "python" : stack === "go" ? "go" : stack.startsWith("java") ? "java-kotlin" : "javascript-typescript";
    const build = stack.startsWith("java") || stack === "go" ? "autobuild" : "none";
    return `name: Security

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: "0 6 * * 1"

permissions:
  contents: read

jobs:
  codeql:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: ${language}
          build-mode: ${build}
      - uses: github/codeql-action/analyze@v3

  dependency-review:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high

  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Scan for committed secrets
        run: |
          docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:v8.21.2 detect --source /repo --redact --no-banner
`;
}
exports.securityWorkflow = securityWorkflow;
//# sourceMappingURL=devops-ci.js.map