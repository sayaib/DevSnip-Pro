/**
 * CRUD resources for Spring Boot (JPA + Bean Validation), ASP.NET Core Web
 * API (controllers + EF Core + data annotations) and FastAPI (SQLAlchemy 2 +
 * Pydantic v2), from the same field list as the Node scaffolds. Every
 * generated API has paginated list, get, create (201 + Location), partial
 * update, delete (204), 400 on invalid input (FastAPI: its standard 422),
 * 404 and 409 on a duplicate.
 */
import type { GeneratedFile } from "../types";
import { Field, camelOf, kebabOf, pascalOf, pluralOf, words } from "./web-scaffold";

export type SqlDatabase = "postgres" | "mysql" | "sqlserver" | "sqlite";

const snake = (name: string) => words(name).join("_") || "item";
const upperFirst = (name: string) => name[0].toUpperCase() + name.slice(1);
const indent = (text: string, spaces: number) => text.split("\n").map(line => (line ? " ".repeat(spaces) + line : line)).join("\n");
const enumPattern = (f: Field) => f.values.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");

// ---------------------------------------------------------------------------
// Spring Boot 3
// ---------------------------------------------------------------------------

function javaType(f: Field): string {
  return ({ string: "String", text: "String", int: "Integer", number: "BigDecimal", boolean: "Boolean", date: "Instant", email: "String", url: "String", uuid: "UUID", enum: "String", "string[]": "List<String>", "number[]": "List<BigDecimal>", json: "Map<String, Object>" } as const)[f.type];
}

function javaConstraints(f: Field, create: boolean): string[] {
  const c: string[] = [];
  const text = ["string", "email", "url", "text", "enum"].includes(f.type);
  if (create && f.required) c.push(text ? "@NotBlank" : f.type.endsWith("[]") ? "@NotEmpty" : "@NotNull");
  if (f.type === "string") c.push(create ? "@Size(max = 255)" : "@Size(min = 1, max = 255)");
  if (f.type === "text") c.push("@Size(max = 10000)");
  if (f.type === "email") c.push("@Email", "@Size(max = 255)");
  if (f.type === "url") c.push("@URL", "@Size(max = 2048)");
  if (f.type === "enum") c.push(`@Pattern(regexp = ${JSON.stringify(enumPattern(f))}, message = ${JSON.stringify(`must be one of: ${f.values.join(", ")}`)})`);
  if (f.type === "int" || f.type === "number") c.push(f.type === "int" ? "@Min(0)" : "@DecimalMin(\"0\")");
  return c;
}

function javaColumn(f: Field): string {
  if (f.type === "string[]" || f.type === "number[]") return "@ElementCollection";
  if (f.type === "json") return `@JdbcTypeCode(SqlTypes.JSON)\n@Column(name = "${snake(f.name)}")`;
  const attrs = [`name = "${snake(f.name)}"`];
  if (f.required) attrs.push("nullable = false");
  if (f.unique) attrs.push("unique = true");
  if (f.type === "text") attrs.push("length = 10000");
  else if (f.type === "url") attrs.push("length = 2048");
  else if (["string", "email", "enum"].includes(f.type)) attrs.push("length = 255");
  if (f.type === "number") attrs.push("precision = 19", "scale = 4");
  return `@Column(${attrs.join(", ")})`;
}

export function springResource(resource: string, fields: Field[], basePackage: string, db: SqlDatabase): { files: GeneratedFile[]; steps: string[] } {
  const R = pascalOf(resource), r = camelOf(resource), plural = pluralOf(r);
  const featurePackage = `${basePackage}.${plural.toLowerCase()}`;
  const webPackage = `${basePackage}.web`;
  const dir = `src/main/java/${featurePackage.replace(/\./g, "/")}`;
  const webDir = `src/main/java/${webPackage.replace(/\./g, "/")}`;
  const imports = (types: string[]) => {
    const all = types.join(" ");
    return [
      /BigDecimal/.test(all) && "import java.math.BigDecimal;",
      /Instant/.test(all) && "import java.time.Instant;",
      /List</.test(all) && "import java.util.List;",
      /ArrayList/.test(all) && "import java.util.ArrayList;",
      /Map</.test(all) && "import java.util.Map;",
      /UUID/.test(all) && "import java.util.UUID;"
    ].filter(Boolean).join("\n");
  };
  const types = fields.map(javaType);

  const entityFields = fields.map(f => {
    const init = f.type.endsWith("[]") ? " = new ArrayList<>()" : "";
    return `${javaColumn(f)}\nprivate ${javaType(f)} ${f.name}${init};`;
  }).join("\n\n");
  const accessors = [{ name: "id", type: "UUID" }, ...fields.map(f => ({ name: f.name, type: javaType(f) })), { name: "createdAt", type: "Instant" }, { name: "updatedAt", type: "Instant" }]
    .map(a => `public ${a.type} get${upperFirst(a.name)}() { return ${a.name}; }${a.name === "id" || a.name.endsWith("At") ? "" : `\npublic void set${upperFirst(a.name)}(${a.type} ${a.name}) { this.${a.name} = ${a.name}; }`}`).join("\n\n");
  const entity = `package ${featurePackage};

import jakarta.persistence.*;
${fields.some(f => f.type === "json") ? "import org.hibernate.annotations.JdbcTypeCode;\nimport org.hibernate.type.SqlTypes;\n" : ""}${imports([...types, "UUID", "Instant", ...(fields.some(f => f.type.endsWith("[]")) ? ["ArrayList"] : [])])}

@Entity
@Table(name = "${snake(plural)}")
public class ${R} {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

${indent(entityFields, 4)}

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

${indent(accessors, 4)}
}
`;

  const record = (name: string, create: boolean) => `public record ${name}(
${fields.map(f => `        ${[...javaConstraints(f, create), javaType(f).replace(/^List<String>$/, "List<@NotBlank String>")].join(" ")} ${f.name}`).join(",\n")}
) {}`;
  const validationImports = "import jakarta.validation.constraints.*;" + (fields.some(f => f.type === "url") ? "\nimport org.hibernate.validator.constraints.URL;" : "");
  const dtos: GeneratedFile[] = [
    { path: `${dir}/Create${R}Request.java`, language: "java", content: `package ${featurePackage};\n\n${validationImports}\n${imports(types)}\n\n${record(`Create${R}Request`, true)}\n` },
    { path: `${dir}/Update${R}Request.java`, language: "java", content: `package ${featurePackage};\n\n${validationImports}\n${imports(types)}\n\n/** Every field is optional: only the fields sent are changed. */\n${record(`Update${R}Request`, false)}\n` },
    {
      path: `${dir}/${R}Response.java`, language: "java", content: `package ${featurePackage};

${imports([...types, "UUID", "Instant"])}

public record ${R}Response(
        UUID id,
${fields.map(f => `        ${javaType(f)} ${f.name},`).join("\n")}
        Instant createdAt,
        Instant updatedAt
) {
    static ${R}Response from(${R} ${r}) {
        return new ${R}Response(
                ${r}.getId(),
${fields.map(f => `                ${f.type.endsWith("[]") ? `List.copyOf(${r}.get${upperFirst(f.name)}())` : `${r}.get${upperFirst(f.name)}()`},`).join("\n")}
                ${r}.getCreatedAt(),
                ${r}.getUpdatedAt());
    }
}
`
    }
  ];

  const copy = (from: string, target: string, partial: boolean) => fields.map(f => {
    const value = f.type.endsWith("[]") ? `new ArrayList<>(${from}.${f.name}())` : `${from}.${f.name}()`;
    const set = `${target}.set${upperFirst(f.name)}(${value});`;
    if (partial) return `if (${from}.${f.name}() != null) ${set}`;
    return f.type.endsWith("[]") ? `${target}.set${upperFirst(f.name)}(${from}.${f.name}() == null ? new ArrayList<>() : ${value});` : set;
  }).join("\n");

  const service = `package ${featurePackage};

import ${webPackage}.PageResponse;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

${fields.some(f => f.type.endsWith("[]")) ? "import java.util.ArrayList;\n" : ""}import java.util.UUID;

@Service
@Transactional
public class ${R}Service {

    private final ${R}Repository repository;

    public ${R}Service(${R}Repository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public PageResponse<${R}Response> list(int page, int size) {
        Page<${R}> result = repository.findAll(PageRequest.of(page - 1, size, Sort.by(Sort.Direction.DESC, "createdAt")));
        return new PageResponse<>(result.map(${R}Response::from).getContent(), page, size, result.getTotalElements(), result.getTotalPages());
    }

    @Transactional(readOnly = true)
    public ${R}Response get(UUID id) {
        return ${R}Response.from(find(id));
    }

    public ${R}Response create(Create${R}Request request) {
        ${R} ${r} = new ${R}();
${indent(copy("request", r, false), 8)}
        return ${R}Response.from(repository.saveAndFlush(${r}));
    }

    public ${R}Response update(UUID id, Update${R}Request request) {
        ${R} ${r} = find(id);
${indent(copy("request", r, true), 8)}
        return ${R}Response.from(repository.saveAndFlush(${r}));
    }

    public void delete(UUID id) {
        repository.delete(find(id));
    }

    private ${R} find(UUID id) {
        return repository.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "${R} not found"));
    }
}
`;

  const controller = `package ${featurePackage};

import ${webPackage}.PageResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.UUID;

@RestController
@RequestMapping("/api/${kebabOf(plural)}")
public class ${R}Controller {

    private final ${R}Service service;

    public ${R}Controller(${R}Service service) {
        this.service = service;
    }

    @GetMapping
    public PageResponse<${R}Response> list(@RequestParam(defaultValue = "1") int page, @RequestParam(defaultValue = "20") int size) {
        return service.list(Math.max(page, 1), Math.min(Math.max(size, 1), 100));
    }

    @GetMapping("/{id}")
    public ${R}Response get(@PathVariable UUID id) {
        return service.get(id);
    }

    @PostMapping
    public ResponseEntity<${R}Response> create(@Valid @RequestBody Create${R}Request request, UriComponentsBuilder uri) {
        ${R}Response created = service.create(request);
        return ResponseEntity.created(uri.path("/api/${kebabOf(plural)}/{id}").buildAndExpand(created.id()).toUri()).body(created);
    }

    @PatchMapping("/{id}")
    public ${R}Response update(@PathVariable UUID id, @Valid @RequestBody Update${R}Request request) {
        return service.update(id, request);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        service.delete(id);
    }
}
`;

  const files: GeneratedFile[] = [
    { path: `${dir}/${R}.java`, language: "java", content: entity },
    { path: `${dir}/${R}Repository.java`, language: "java", content: `package ${featurePackage};\n\nimport org.springframework.data.jpa.repository.JpaRepository;\n\nimport java.util.UUID;\n\npublic interface ${R}Repository extends JpaRepository<${R}, UUID> {\n}\n` },
    ...dtos,
    { path: `${dir}/${R}Service.java`, language: "java", content: service },
    { path: `${dir}/${R}Controller.java`, language: "java", content: controller },
    { path: `${webDir}/PageResponse.java`, language: "java", content: `package ${webPackage};\n\nimport java.util.List;\n\npublic record PageResponse<T>(List<T> items, int page, int size, long total, int pages) {\n}\n` },
    {
      path: `${webDir}/ApiExceptionHandler.java`, language: "java", content: `package ${webPackage};

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

/** Turns validation errors into 400 and unique-constraint violations into 409, as RFC 9457 problem details. */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail validationFailed(MethodArgumentNotValidException ex) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        Map<String, String> errors = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error -> errors.putIfAbsent(error.getField(), error.getDefaultMessage()));
        problem.setProperty("errors", errors);
        return problem;
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ProblemDetail conflict(DataIntegrityViolationException ex) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "A record with the same unique value already exists.");
    }
}
`
    }
  ];

  const driver = { postgres: ["org.postgresql:postgresql", "jdbc:postgresql://localhost:5432/app"], mysql: ["com.mysql:mysql-connector-j", "jdbc:mysql://localhost:3306/app"], sqlserver: ["com.microsoft.sqlserver:mssql-jdbc", "jdbc:sqlserver://localhost:1433;databaseName=app;encrypt=false"], sqlite: ["com.h2database:h2", "jdbc:h2:file:./data/app"] }[db];
  const steps = [
    `Spring Boot 3 (Java 17+). Dependencies: spring-boot-starter-web, spring-boot-starter-validation, spring-boot-starter-data-jpa and ${driver[0]} (runtime).`,
    `application.properties: spring.datasource.url=${driver[1]}${db === "sqlite" ? "" : " plus spring.datasource.username / password"}; for development spring.jpa.hibernate.ddl-auto=update (use Flyway or Liquibase migrations in production).`,
    `${basePackage} must be your @SpringBootApplication package (or a parent of it) so the controller and entity are scanned.`,
    `Try it: curl -X POST localhost:8080/api/${kebabOf(plural)} -H 'Content-Type: application/json' -d '{…}'`
  ];
  return { files, steps };
}

// ---------------------------------------------------------------------------
// ASP.NET Core (.NET 8+)
// ---------------------------------------------------------------------------

function csType(f: Field, nullable: boolean): string {
  const base = ({ string: "string", text: "string", int: "int", number: "decimal", boolean: "bool", date: "DateTime", email: "string", url: "string", uuid: "Guid", enum: "string", "string[]": "List<string>", "number[]": "List<decimal>", json: "string" } as const)[f.type];
  return nullable ? `${base}?` : base;
}

function csAttributes(f: Field, create: boolean): string[] {
  const a: string[] = [];
  if (create && f.required) a.push("Required");
  if (f.type === "string") a.push("StringLength(255, MinimumLength = 1)");
  if (f.type === "text") a.push("StringLength(10000)");
  if (f.type === "email") a.push("EmailAddress", "StringLength(255)");
  if (f.type === "url") a.push("Url", "StringLength(2048)");
  if (f.type === "enum") a.push(`RegularExpression(${JSON.stringify(`^(${enumPattern(f)})$`)}, ErrorMessage = ${JSON.stringify(`Must be one of: ${f.values.join(", ")}`)})`);
  if (f.type === "int") a.push("Range(0, int.MaxValue)");
  if (f.type === "number") a.push("Range(typeof(decimal), \"0\", \"79228162514264337593543950335\")");
  if (f.type === "json") a.push("StringLength(100000)");
  return a;
}

export function aspnetResource(resource: string, fields: Field[], rootNamespace: string, db: SqlDatabase): { files: GeneratedFile[]; steps: string[] } {
  const R = pascalOf(resource), plural = pluralOf(camelOf(resource)), Rs = pascalOf(plural);
  const P = (f: Field) => upperFirst(f.name);
  const valueType = (f: Field) => ["int", "number", "boolean", "date", "uuid"].includes(f.type);
  const entityProps = fields.map(f => {
    const nullable = !f.required && !f.type.endsWith("[]");
    const init = f.type.endsWith("[]") ? " = [];" : !nullable && !valueType(f) ? " = \"\";" : "";
    return `public ${csType(f, nullable)} ${P(f)} { get; set; }${init}`;
  }).join("\n");
  const entity = `namespace ${rootNamespace}.Models;

public class ${R}
{
    public Guid Id { get; set; }
${indent(entityProps, 4)}
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
`;
  const requestProps = (create: boolean) => fields.map(f => {
    const attrs = csAttributes(f, create);
    // Value types are nullable on requests so a missing field fails [Required] instead of becoming 0.
    return `${attrs.length ? `[${attrs.join(", ")}]\n` : ""}public ${csType(f, true)} ${P(f)} { get; init; }`;
  }).join("\n\n");
  const dtos = `using System.ComponentModel.DataAnnotations;
using ${rootNamespace}.Models;

namespace ${rootNamespace}.Dtos;

public class Create${R}Request
{
${indent(requestProps(true), 4)}
}

/// <summary>Every field is optional: only the fields sent are changed.</summary>
public class Update${R}Request
{
${indent(requestProps(false), 4)}
}

public record ${R}Response(
    Guid Id,
${fields.map(f => `    ${csType(f, !f.required && !f.type.endsWith("[]"))} ${P(f)},`).join("\n")}
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    public static ${R}Response From(${R} entity) => new(
        entity.Id,
${fields.map(f => `        entity.${P(f)},`).join("\n")}
        entity.CreatedAt,
        entity.UpdatedAt);
}

public record PagedResponse<T>(IReadOnlyList<T> Items, int Page, int PageSize, int Total, int Pages);
`;
  const assign = (partial: boolean) => fields.map(f => {
    if (partial) return f.type.endsWith("[]") ? `if (request.${P(f)} is not null) entity.${P(f)} = request.${P(f)};` : `if (request.${P(f)} is not null) entity.${P(f)} = request.${P(f)}${valueType(f) ? ".Value" : ""};`;
    if (f.type.endsWith("[]")) return `${P(f)} = request.${P(f)} ?? [],`;
    if (f.required) return `${P(f)} = request.${P(f)}${valueType(f) ? ".GetValueOrDefault()" : "!"},`; // [Required] already rejected null
    return `${P(f)} = request.${P(f)},`;
  }).join("\n");
  const controller = `using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ${rootNamespace}.Data;
using ${rootNamespace}.Dtos;
using ${rootNamespace}.Models;

namespace ${rootNamespace}.Controllers;

[ApiController]
[Route("api/${kebabOf(plural)}")]
public class ${Rs}Controller(AppDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PagedResponse<${R}Response>>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.${Rs}.AsNoTracking().OrderByDescending(x => x.CreatedAt);
        var total = await query.CountAsync(ct);
        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return new PagedResponse<${R}Response>(items.Select(${R}Response.From).ToList(), page, pageSize, total, (int)Math.Ceiling(total / (double)pageSize));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<${R}Response>> Get(Guid id, CancellationToken ct)
    {
        var entity = await db.${Rs}.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return entity is null ? NotFound() : ${R}Response.From(entity);
    }

    [HttpPost]
    public async Task<ActionResult<${R}Response>> Create(Create${R}Request request, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var entity = new ${R}
        {
            Id = Guid.NewGuid(),
${indent(assign(false), 12)}
            CreatedAt = now,
            UpdatedAt = now
        };
        db.${Rs}.Add(entity);
        if (!await TrySaveAsync(ct)) return Conflict(Problem409());
        return CreatedAtAction(nameof(Get), new { id = entity.Id }, ${R}Response.From(entity));
    }

    [HttpPatch("{id:guid}")]
    public async Task<ActionResult<${R}Response>> Update(Guid id, Update${R}Request request, CancellationToken ct)
    {
        var entity = await db.${Rs}.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (entity is null) return NotFound();
${indent(assign(true), 8)}
        entity.UpdatedAt = DateTime.UtcNow;
        if (!await TrySaveAsync(ct)) return Conflict(Problem409());
        return ${R}Response.From(entity);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var deleted = await db.${Rs}.Where(x => x.Id == id).ExecuteDeleteAsync(ct);
        return deleted == 0 ? NotFound() : NoContent();
    }

    private async Task<bool> TrySaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException)
        {
            // A unique index was violated (or another constraint): report a conflict, not a 500.
            return false;
        }
    }

    private static ProblemDetails Problem409() => new() { Status = StatusCodes.Status409Conflict, Title = "A ${R.toLowerCase()} with the same unique value already exists." };
}
`;
  const modelConfig = [
    ...fields.filter(f => f.type === "string" || f.type === "email" || f.type === "enum").map(f => `entity.Property(x => x.${P(f)}).HasMaxLength(255);`),
    ...fields.filter(f => f.type === "url").map(f => `entity.Property(x => x.${P(f)}).HasMaxLength(2048);`),
    ...fields.filter(f => f.type === "number").map(f => `entity.Property(x => x.${P(f)}).HasPrecision(19, 4);`),
    ...fields.filter(f => f.unique).map(f => `entity.HasIndex(x => x.${P(f)}).IsUnique();`),
    "entity.HasIndex(x => x.CreatedAt);"
  ];
  const dbContext = `using Microsoft.EntityFrameworkCore;
using ${rootNamespace}.Models;

namespace ${rootNamespace}.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<${R}> ${Rs} => Set<${R}>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<${R}>(entity =>
        {
${indent(modelConfig.join("\n"), 12)}
        });
    }
}
`;
  const provider = { postgres: ["Npgsql.EntityFrameworkCore.PostgreSQL", "UseNpgsql", "Host=localhost;Database=app;Username=app;Password=…"], mysql: ["Pomelo.EntityFrameworkCore.MySql", "UseMySql", "Server=localhost;Database=app;User=app;Password=…"], sqlserver: ["Microsoft.EntityFrameworkCore.SqlServer", "UseSqlServer", "Server=localhost;Database=app;Trusted_Connection=True;TrustServerCertificate=True"], sqlite: ["Microsoft.EntityFrameworkCore.Sqlite", "UseSqlite", "Data Source=app.db"] }[db];
  const use = db === "mysql" ? `${provider[1]}(cs, ServerVersion.AutoDetect(cs))` : `${provider[1]}(cs)`;
  return {
    files: [
      { path: `Models/${R}.cs`, language: "csharp", content: entity },
      { path: `Dtos/${R}Dtos.cs`, language: "csharp", content: dtos },
      { path: `Controllers/${Rs}Controller.cs`, language: "csharp", content: controller },
      { path: "Data/AppDbContext.cs", language: "csharp", content: dbContext }
    ],
    steps: [
      `.NET 8 or later. dotnet add package ${provider[0]} and dotnet add package Microsoft.EntityFrameworkCore.Design (for migrations).`,
      `Program.cs: var cs = builder.Configuration.GetConnectionString("Default"); builder.Services.AddDbContext<AppDbContext>(o => o.${use}); builder.Services.AddControllers(); … app.MapControllers();`,
      `appsettings.json: "ConnectionStrings": { "Default": "${provider[2]}" }`,
      `dotnet ef migrations add Add${Rs} && dotnet ef database update (dotnet tool install --global dotnet-ef once).`,
      `If you already have a DbContext, add the DbSet and the OnModelCreating lines to it instead of using Data/AppDbContext.cs.`
    ]
  };
}

// ---------------------------------------------------------------------------
// FastAPI + SQLAlchemy 2 + Pydantic v2
// ---------------------------------------------------------------------------

function pyType(f: Field): string {
  return ({ string: "str", text: "str", int: "int", number: "float", boolean: "bool", date: "datetime", email: "EmailStr", url: "str", uuid: "uuid.UUID", enum: `Literal[${f.values.map(v => JSON.stringify(v)).join(", ")}]`, "string[]": "list[str]", "number[]": "list[float]", json: "dict[str, Any]" } as const)[f.type];
}

function pyField(f: Field, optional: boolean): string {
  const args: string[] = [];
  if (f.type === "string") args.push("min_length=1", "max_length=255");
  if (f.type === "text") args.push("max_length=10000");
  if (f.type === "url") args.push('pattern=r"^https?://"', "max_length=2048");
  if (f.type === "int" || f.type === "number") args.push("ge=0");
  const type = optional ? `Optional[${pyType(f)}]` : pyType(f);
  if (optional) return `${snake(f.name)}: ${type} = ${args.length ? `Field(default=None, ${args.join(", ")})` : "None"}`;
  return `${snake(f.name)}: ${type}${args.length ? ` = Field(${args.join(", ")})` : ""}`;
}

function sqlColumn(f: Field): string {
  const t = ({ string: "String(255)", text: "Text", int: "Integer", number: "Float", boolean: "Boolean", date: "DateTime(timezone=True)", email: "String(255)", url: "String(2048)", uuid: "Uuid", enum: "String(50)", "string[]": "JSON", "number[]": "JSON", json: "JSON" } as const)[f.type];
  const mapped = f.required ? pyType(f).replace("EmailStr", "str").replace(/^Literal\[.*\]$/, "str") : `Optional[${pyType(f).replace("EmailStr", "str").replace(/^Literal\[.*\]$/, "str")}]`;
  return `${snake(f.name)}: Mapped[${mapped}] = mapped_column(${t}${f.unique ? ", unique=True" : ""}${f.required ? ", nullable=False" : ""})`;
}

export function fastapiResource(resource: string, fields: Field[], db: SqlDatabase): { files: GeneratedFile[]; steps: string[] } {
  const R = pascalOf(resource), plural = snake(pluralOf(camelOf(resource))), r = snake(resource);
  const pkg = `app/${plural}`;
  const usesAny = fields.some(f => f.type === "json");
  const typing = ["Optional", ...(usesAny ? ["Any"] : []), ...(fields.some(f => f.type === "enum") ? ["Literal"] : [])].join(", ");
  const sqlTypes = [...new Set(["DateTime", "Uuid", ...fields.map(f => ({ string: "String", text: "Text", int: "Integer", number: "Float", boolean: "Boolean", date: "DateTime", email: "String", url: "String", uuid: "Uuid", enum: "String", "string[]": "JSON", "number[]": "JSON", json: "JSON" } as const)[f.type])])].sort();
  const models = `import uuid
from datetime import datetime, timezone
from typing import ${["Optional", ...(usesAny ? ["Any"] : [])].join(", ")}

from sqlalchemy import ${sqlTypes.join(", ")}
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ${R}(Base):
    __tablename__ = "${plural}"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
${fields.map(f => `    ${sqlColumn(f)}`).join("\n")}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
`;
  const readFields = fields.map(f => `    ${snake(f.name)}: ${f.required ? pyType(f).replace("EmailStr", "str") : `Optional[${pyType(f).replace("EmailStr", "str")}] = None`}`).join("\n");
  const schemas = `import uuid
from datetime import datetime
from typing import ${typing}

from pydantic import BaseModel, ConfigDict, ${fields.some(f => f.type === "email") ? "EmailStr, " : ""}Field


class ${R}Create(BaseModel):
    model_config = ConfigDict(extra="forbid")

${fields.map(f => `    ${pyField(f, !f.required)}`).join("\n")}


class ${R}Update(BaseModel):
    """Every field is optional: only the fields sent are changed."""

    model_config = ConfigDict(extra="forbid")

${fields.map(f => `    ${pyField(f, true)}`).join("\n")}


class ${R}Read(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
${readFields}
    created_at: datetime
    updated_at: datetime


class ${R}Page(BaseModel):
    items: list[${R}Read]
    page: int
    limit: int
    total: int
    pages: int
`;
  const router = `import math
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.${plural}.models import ${R}
from app.${plural}.schemas import ${R}Create, ${R}Page, ${R}Read, ${R}Update

router = APIRouter(prefix="/${kebabOf(pluralOf(camelOf(resource)))}", tags=["${plural}"])
DbSession = Annotated[Session, Depends(get_db)]


def _get_or_404(db: Session, item_id: uuid.UUID) -> ${R}:
    item = db.get(${R}, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${R} not found")
    return item


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A ${r.replace(/_/g, " ")} with the same unique value already exists.")


@router.get("", response_model=${R}Page)
def list_${plural}(db: DbSession, page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100)) -> ${R}Page:
    total = db.scalar(select(func.count()).select_from(${R})) or 0
    items = db.scalars(select(${R}).order_by(${R}.created_at.desc()).offset((page - 1) * limit).limit(limit)).all()
    return ${R}Page(items=[${R}Read.model_validate(item) for item in items], page=page, limit=limit, total=total, pages=math.ceil(total / limit))


@router.get("/{item_id}", response_model=${R}Read)
def get_${r}(item_id: uuid.UUID, db: DbSession) -> ${R}:
    return _get_or_404(db, item_id)


@router.post("", response_model=${R}Read, status_code=status.HTTP_201_CREATED)
def create_${r}(payload: ${R}Create, db: DbSession) -> ${R}:
    item = ${R}(**payload.model_dump())
    db.add(item)
    _commit(db)
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=${R}Read)
def update_${r}(item_id: uuid.UUID, payload: ${R}Update, db: DbSession) -> ${R}:
    item = _get_or_404(db, item_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    _commit(db)
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_${r}(item_id: uuid.UUID, db: DbSession) -> None:
    db.delete(_get_or_404(db, item_id))
    _commit(db)
`;
  const url = { postgres: ["postgresql+psycopg://app:password@localhost:5432/app", "psycopg[binary]"], mysql: ["mysql+pymysql://app:password@localhost:3306/app", "pymysql"], sqlserver: ["mssql+pyodbc://app:password@localhost/app?driver=ODBC+Driver+18+for+SQL+Server", "pyodbc"], sqlite: ["sqlite:///./app.db", ""] }[db];
  const database = `import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "${url[0]}")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session
`;
  return {
    files: [
      { path: "app/__init__.py", language: "python", content: "" },
      { path: "app/database.py", language: "python", content: database },
      { path: `${pkg}/__init__.py`, language: "python", content: "" },
      { path: `${pkg}/models.py`, language: "python", content: models },
      { path: `${pkg}/schemas.py`, language: "python", content: schemas },
      { path: `${pkg}/router.py`, language: "python", content: router }
    ],
    steps: [
      `pip install "fastapi[standard]" "sqlalchemy>=2"${fields.some(f => f.type === "email") ? " email-validator" : ""}${url[1] ? ` "${url[1]}"` : ""}`,
      `app/main.py: from app.${plural}.router import router as ${plural}_router; app.include_router(${plural}_router, prefix="/api"). For development call Base.metadata.create_all(bind=engine) at startup; use Alembic migrations in production.`,
      `Set DATABASE_URL (default ${url[0]}). Run: fastapi dev app/main.py, then open http://127.0.0.1:8000/docs.`
    ]
  };
}
