import * as fs from "fs";
import * as path from "path";

export interface UpsertEnvOptions {
  /**
   * Optional header comment to insert when creating a new file
   * or when the comment is not yet present.
   */
  headerComment?: string;
}

export interface ParsedEnvLine {
  raw: string;
  key?: string;
  value?: string;
  isCommentOrBlank: boolean;
}

/**
 * Parses a single line from an environment file into key, value, or raw non-variable line.
 * Correctly distinguishes comments and handles optional `export ` prefix.
 */
export function parseEnvLine(line: string): ParsedEnvLine {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return { raw: line, isCommentOrBlank: true };
  }

  const match = line.match(
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/
  );
  if (!match) {
    return { raw: line, isCommentOrBlank: true };
  }

  const key = match[1];
  let val = match[2];

  // Strip enclosing quotes if present
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }

  return {
    raw: line,
    key,
    value: val,
    isCommentOrBlank: false,
  };
}

/**
 * Reads an environment file into a key-value dictionary.
 */
export function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const result: Record<string, string> = {};

  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (parsed.key !== undefined && parsed.value !== undefined) {
      result[parsed.key] = parsed.value;
    }
  }

  return result;
}

/**
 * Upserts environment variables into an existing or new .env file without destroying
 * user comments, whitespace, or unmanaged variables.
 */
export function upsertEnvFile(
  filePath: string,
  updates: Record<string, string>,
  options?: UpsertEnvOptions
): void {
  let existingContent = "";
  const fileExists = fs.existsSync(filePath);
  if (fileExists) {
    existingContent = fs.readFileSync(filePath, "utf-8");
  }

  // Determine line ending style (\r\n vs \n)
  const eol = existingContent.includes("\r\n") ? "\r\n" : "\n";
  const lines =
    fileExists && existingContent.length > 0
      ? existingContent.split(/\r?\n/)
      : [];

  const updatedKeys = new Set(Object.keys(updates));
  const seenUpdatedKeys = new Set<string>();
  const newLines: string[] = [];

  for (const line of lines) {
    const parsed = parseEnvLine(line);
    if (parsed.key && updatedKeys.has(parsed.key)) {
      if (!seenUpdatedKeys.has(parsed.key)) {
        newLines.push(`${parsed.key}=${updates[parsed.key]}`);
        seenUpdatedKeys.add(parsed.key);
      }
      // If we've already replaced this key once, skip duplicate lines for the key
      continue;
    }
    newLines.push(line);
  }

  // Determine missing keys to append
  const appendKeys = Object.keys(updates).filter(
    (k) => !seenUpdatedKeys.has(k)
  );

  if (appendKeys.length > 0) {
    // If the file was not empty and didn't end with an empty line, add a newline separator
    while (newLines.length > 0 && newLines[newLines.length - 1].trim() === "") {
      newLines.pop();
    }
    if (newLines.length > 0) {
      newLines.push("");
    }
    for (const key of appendKeys) {
      newLines.push(`${key}=${updates[key]}`);
    }
  }

  // Add header comment if provided and not already present
  if (
    options?.headerComment &&
    (!fileExists || !existingContent.includes(options.headerComment))
  ) {
    // If new file or top of file doesn't have it, insert at top
    newLines.unshift(options.headerComment);
  }

  // Ensure trailing newline
  const finalContent = newLines.join(eol).trimEnd() + eol;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, finalContent, "utf-8");
}
