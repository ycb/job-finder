import chalk from "chalk";
import figures from "figures";
import isInteractive from "is-interactive";

function normalizeGlobalOutputOptions(options = {}) {
  return {
    quiet: Boolean(options.quiet),
    json: Boolean(options.json)
  };
}

export function parseGlobalOutputOptions(args) {
  const options = normalizeGlobalOutputOptions();
  const remaining = [];

  for (const rawArg of Array.isArray(args) ? args : []) {
    if (rawArg === "--quiet") {
      options.quiet = true;
      continue;
    }
    if (rawArg === "--json") {
      options.json = true;
      continue;
    }
    remaining.push(rawArg);
  }

  return {
    options,
    args: remaining
  };
}

export function createCliOutput(options = {}) {
  const normalized = normalizeGlobalOutputOptions(options);
  const interactive = isInteractive({stream: process.stdout}) && !normalized.json;
  const muted = normalized.quiet || normalized.json;

  function stdout(message) {
    if (muted) {
      return;
    }
    process.stdout.write(`${message}\n`);
  }

  function stderr(message) {
    process.stderr.write(`${message}\n`);
  }

  function json(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  const symbols = interactive
    ? {
        success: chalk.green(figures.tick),
        warn: chalk.yellow(figures.warning),
        error: chalk.red(figures.cross),
        info: chalk.cyan(figures.info)
      }
    : {
        success: "OK",
        warn: "WARN",
        error: "ERR",
        info: "INFO"
      };

  return {
    interactive,
    quiet: normalized.quiet,
    jsonEnabled: normalized.json,
    stdout,
    stderr,
    json,
    success(message) {
      stdout(`${symbols.success} ${message}`);
    },
    warn(message) {
      stdout(`${symbols.warn} ${message}`);
    },
    info(message) {
      stdout(`${symbols.info} ${message}`);
    },
    error(message) {
      stderr(`${symbols.error} ${message}`);
    }
  };
}
