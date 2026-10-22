/**
 * Reads the text output of `mvn dependency:tree -DoutputType=text` (one tree
 * per reactor module when `-DappendOutput=true` is used):
 *
 *   com.example:app:jar:1.0.0
 *   +- org.springframework.boot:spring-boot-starter-web:jar:2.6.6:compile
 *   |  \- org.apache.tomcat.embed:tomcat-embed-core:jar:9.0.60:compile
 *   \- net.sf.json-lib:json-lib:jar:jdk15:2.4:compile (optional)
 */

export interface TreeNode {
  groupId: string;
  artifactId: string;
  type: string;
  classifier?: string;
  version: string;
  scope: string;
  optional: boolean;
  depth: number;
  /** Coordinates (group:artifact:version) from the module's direct dependency to this node's parent. */
  via: string[];
}

export interface ModuleTree {
  groupId: string;
  artifactId: string;
  packaging: string;
  version: string;
  nodes: TreeNode[];
}

const PREFIX = /^((?:[|+\\ ] {2}|[+\\]- )*)(\S.*)$/;

/** Parses `g:a:type[:classifier]:version[:scope]` plus Maven's trailing annotations. */
export function parseCoordinate(text: string): Omit<TreeNode, "depth" | "via"> | undefined {
  let coordinate = text.trim();
  const optional = /\(optional\)/.test(coordinate);
  // Annotations: " (optional)", " (version managed from 1.0)", "(scope not updated to compile)".
  coordinate = coordinate.replace(/\s*\(.*$/, "").trim();
  const parts = coordinate.split(":");
  if (parts.length < 4 || parts.length > 6 || parts.some(p => !p)) return undefined;
  if (parts.length === 4) {
    const [groupId, artifactId, type, version] = parts;
    return { groupId, artifactId, type, version, scope: "", optional };
  }
  if (parts.length === 5) {
    const [groupId, artifactId, type, version, scope] = parts;
    return { groupId, artifactId, type, version, scope, optional };
  }
  const [groupId, artifactId, type, classifier, version, scope] = parts;
  return { groupId, artifactId, type, classifier, version, scope, optional };
}

export function parseDependencyTree(text: string): ModuleTree[] {
  const modules: ModuleTree[] = [];
  let current: ModuleTree | undefined;
  const stack: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const line = raw.replace(/^\[INFO\]\s?/, "");
    const match = PREFIX.exec(line);
    if (!match) continue;
    const prefix = match[1];
    const parsed = parseCoordinate(match[2]);
    if (!parsed) continue;
    if (!prefix) {
      current = { groupId: parsed.groupId, artifactId: parsed.artifactId, packaging: parsed.type, version: parsed.version, nodes: [] };
      modules.push(current);
      stack.length = 0;
      continue;
    }
    if (!current) continue;
    const depth = prefix.length / 3;
    stack.length = depth - 1;
    current.nodes.push({ ...parsed, scope: parsed.scope || "compile", depth, via: stack.slice(0, depth - 1) });
    stack[depth - 1] = `${parsed.groupId}:${parsed.artifactId}:${parsed.version}`;
  }
  return modules;
}
