import path from "node:path";

function relativeFile(cwd, filePath) {
  const relative = path.relative(cwd, filePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return "<outside-workspace>";
  }
  return relative.split(path.sep).join("/");
}

function compareMessages(left, right) {
  return (
    left.line - right.line ||
    left.column - right.column ||
    right.severity - left.severity ||
    compareText(left.ruleId ?? "", right.ruleId ?? "") ||
    compareText(left.message, right.message)
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function formatLintResults(results, context) {
  const relevant = results
    .filter((result) => result.messages.length > 0)
    .map((result) => ({
      file: relativeFile(context.cwd, result.filePath),
      messages: [...result.messages].sort(compareMessages)
    }))
    .sort((left, right) => compareText(left.file, right.file));
  if (relevant.length === 0) return "";

  const lines = [];
  let errors = 0;
  let warnings = 0;
  let fixable = 0;
  for (const result of relevant) {
    lines.push(result.file);
    for (const message of result.messages) {
      const severity = message.severity === 2 ? "error" : "warning";
      if (message.severity === 2) errors += 1;
      else warnings += 1;
      if (message.fix !== undefined) fixable += 1;
      lines.push(
        `  ${message.line}:${message.column}  ${severity}  ${message.message}  ${message.ruleId ?? "fatal"}`
      );
    }
    lines.push("");
  }
  const problems = errors + warnings;
  lines.push(
    `${countLabel(problems, "problem", "problems")} (${countLabel(errors, "error", "errors")}, ${countLabel(warnings, "warning", "warnings")}; ${countLabel(fixable, "fixable", "fixable")})`
  );
  return `${lines.join("\n")}\n`;
}
