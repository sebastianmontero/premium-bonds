import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";
import {
  maskSecret,
  validateDatabaseUrl,
  determineVercelEnvType,
  resolveVercelBinaryConfig,
  createVercelCliRunner,
  isProjectLinked,
  checkVercelPreflight,
  parseSyncArgs,
  executeVercelSync,
  VERCEL_CONFIG_FILES,
  VercelCliRunner,
} from "./sync-vercel-envs";

describe("sync-vercel-envs unit tests", () => {
  describe("maskSecret", () => {
    it("should return non-sensitive values unmodified", () => {
      assert.equal(
        maskSecret("NEXT_PUBLIC_ENVIRONMENT", "production"),
        "production"
      );
      assert.equal(
        maskSecret(
          "NEXT_PUBLIC_PROGRAM_ID",
          "PBond11111111111111111111111111111111111111"
        ),
        "PBond11111111111111111111111111111111111111"
      );
    });

    it("should safely redact passwords in database connection strings while preserving host and db", () => {
      const dbUrl =
        "postgresql://neondb_owner:npg_supersecretpass123@ep-fragrant-pond.us-east-2.aws.neon.tech/neondb?sslmode=require";
      const masked = maskSecret("DATABASE_URL", dbUrl);
      assert.match(
        masked,
        /postgresql:\/\/neondb_owner:\*{8}@ep-fragrant-pond\.us-east-2\.aws\.neon\.tech\/neondb/
      );
      assert.ok(!masked.includes("npg_supersecretpass123"));
    });

    it("should mask short sensitive keys completely", () => {
      assert.equal(maskSecret("PUSHER_KEY", "12345"), "********");
      assert.equal(maskSecret("SECRET_KEY", "12345678"), "********");
    });

    it("should mask medium sensitive keys keeping only suffix", () => {
      const masked = maskSecret("PUSHER_SECRET", "1234567890abcdef");
      assert.equal(masked, "****...cdef");
    });

    it("should mask long sensitive keys keeping prefix and suffix", () => {
      const masked = maskSecret(
        "INDEXER_WEBHOOK_SECRET",
        "super_secret_webhook_token_9999"
      );
      assert.equal(masked, "sup...9999");
    });

    it("should handle empty values gracefully", () => {
      assert.equal(maskSecret("DATABASE_URL", ""), "");
    });
  });

  describe("validateDatabaseUrl", () => {
    it("should approve valid cloud PostgreSQL URLs", () => {
      const res1 = validateDatabaseUrl(
        "postgresql://user:pass@ep-test-pool.neon.tech/neondb?sslmode=require"
      );
      assert.equal(res1.valid, true);

      const res2 = validateDatabaseUrl(
        "postgres://user:pass@aws.connect.psdb.cloud/neondb"
      );
      assert.equal(res2.valid, true);
    });

    it("should allow undefined database URLs for optional check handling", () => {
      const res = validateDatabaseUrl(undefined);
      assert.equal(res.valid, true);
    });

    it("should reject invalid protocols", () => {
      const res = validateDatabaseUrl("http://localhost:5432/db");
      assert.equal(res.valid, false);
      assert.match(
        res.error || "",
        /must be a valid PostgreSQL connection string/
      );
    });

    it("should reject local/loopback database URLs", () => {
      const hosts = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];
      for (const host of hosts) {
        const res = validateDatabaseUrl(
          `postgresql://user:pass@${host}:5432/db`
        );
        assert.equal(res.valid, false);
        assert.match(res.error || "", /points to a local\/loopback host/);
      }
    });
  });

  describe("determineVercelEnvType", () => {
    it("should classify NEXT_PUBLIC_ prefixed variables as config even with sensitive keywords", () => {
      assert.equal(determineVercelEnvType("NEXT_PUBLIC_PUSHER_KEY"), "config");
      assert.equal(determineVercelEnvType("NEXT_PUBLIC_API_KEY"), "config");
      assert.equal(determineVercelEnvType("NEXT_PUBLIC_AUTH_TOKEN"), "config");
      assert.equal(
        determineVercelEnvType("NEXT_PUBLIC_SECRET_PHRASE"),
        "config"
      );
      assert.equal(
        determineVercelEnvType("NEXT_PUBLIC_PRIVATE_LABEL"),
        "config"
      );
      assert.equal(determineVercelEnvType("NEXT_PUBLIC_ENVIRONMENT"), "config");
      assert.equal(determineVercelEnvType("NEXT_PUBLIC_PROGRAM_ID"), "config");
      assert.equal(
        determineVercelEnvType("NEXT_PUBLIC_SOLANA_RPC_URL"),
        "config"
      );
    });

    it("should classify sensitive server-side variables as secret", () => {
      assert.equal(determineVercelEnvType("DATABASE_URL"), "secret");
      assert.equal(determineVercelEnvType("PUSHER_KEY"), "secret");
      assert.equal(determineVercelEnvType("PUSHER_SECRET"), "secret");
      assert.equal(determineVercelEnvType("INDEXER_WEBHOOK_SECRET"), "secret");
      assert.equal(determineVercelEnvType("ADMIN_PRIVATE_KEY"), "secret");
      assert.equal(determineVercelEnvType("AUTH_TOKEN"), "secret");
      assert.equal(determineVercelEnvType("API_CREDENTIALS"), "secret");
      assert.equal(determineVercelEnvType("ENCRYPTION_PASSWORD"), "secret");
    });

    it("should classify non-sensitive server-side variables as config", () => {
      assert.equal(determineVercelEnvType("PUSHER_APP_ID"), "config");
      assert.equal(determineVercelEnvType("PUSHER_CLUSTER"), "config");
      assert.equal(determineVercelEnvType("PORT"), "config");
      assert.equal(determineVercelEnvType("NODE_ENV"), "config");
    });
  });

  describe("resolveVercelBinaryConfig & createVercelCliRunner", () => {
    it("should resolve valid runner configuration", () => {
      const config = resolveVercelBinaryConfig();
      assert.ok(config.executable.length > 0);
      assert.ok(Array.isArray(config.baseArgs));
    });

    it("should instantiate a behavioral runner", () => {
      const runner = createVercelCliRunner();
      assert.equal(typeof runner.exec, "function");
      assert.equal(typeof runner.execCapture, "function");
    });
  });

  describe("isProjectLinked", () => {
    it("should return true when VERCEL_PROJECT_ID is provided in env", () => {
      const linked = isProjectLinked({
        env: { VERCEL_PROJECT_ID: "prj_custom_123" },
        fileExists: () => false,
      });
      assert.equal(linked, true);
    });

    it("should return false when VERCEL_PROJECT_ID is empty or whitespace and configs are missing", () => {
      const linked = isProjectLinked({
        env: { VERCEL_PROJECT_ID: "   " },
        fileExists: () => false,
      });
      assert.equal(linked, false);
    });

    it("should return true when .vercel/project.json exists", () => {
      const linked = isProjectLinked({
        env: {},
        projectDir: "/mock/app",
        fileExists: (filePath) =>
          filePath === path.resolve("/mock/app", ".vercel", "project.json"),
      });
      assert.equal(linked, true);
    });

    it("should return true when .vercel/repo.json exists", () => {
      const linked = isProjectLinked({
        env: {},
        projectDir: "/mock/app",
        fileExists: (filePath) =>
          filePath === path.resolve("/mock/app", ".vercel", "repo.json"),
      });
      assert.equal(linked, true);
    });

    it("should return false when neither config file exists and no env is set", () => {
      const linked = isProjectLinked({
        env: {},
        projectDir: "/mock/app",
        fileExists: () => false,
      });
      assert.equal(linked, false);
    });

    it("should resolve candidate config paths against custom projectDir", () => {
      const queriedPaths: string[] = [];
      isProjectLinked({
        env: {},
        projectDir: "/custom/workspace/root",
        fileExists: (filePath) => {
          queriedPaths.push(filePath);
          return false;
        },
      });

      assert.deepEqual(queriedPaths, [
        path.resolve("/custom/workspace/root", ".vercel", "project.json"),
        path.resolve("/custom/workspace/root", ".vercel", "repo.json"),
      ]);
    });
  });

  describe("checkVercelPreflight", () => {
    it("should succeed when project is linked via .vercel/repo.json and auth succeeds", () => {
      let executedWhoami = false;
      const mockRunner: VercelCliRunner = {
        executable: "node",
        baseArgs: [],
        exec: () => {},
        execCapture: (args) => {
          if (args.includes("whoami")) {
            executedWhoami = true;
            return "user_logged_in";
          }
          return "";
        },
      };

      assert.doesNotThrow(() =>
        checkVercelPreflight(mockRunner, {
          env: {},
          projectDir: "/mock/repo",
          fileExists: (p) => p.endsWith(path.join(".vercel", "repo.json")),
        })
      );
      assert.equal(executedWhoami, true);
    });

    it("should succeed when project is linked via .vercel/project.json and auth succeeds", () => {
      let executedWhoami = false;
      const mockRunner: VercelCliRunner = {
        executable: "node",
        baseArgs: [],
        exec: () => {},
        execCapture: (args) => {
          if (args.includes("whoami")) {
            executedWhoami = true;
            return "user_logged_in";
          }
          return "";
        },
      };

      assert.doesNotThrow(() =>
        checkVercelPreflight(mockRunner, {
          env: {},
          projectDir: "/mock/repo",
          fileExists: (p) => p.endsWith(path.join(".vercel", "project.json")),
        })
      );
      assert.equal(executedWhoami, true);
    });

    it("should support string projectDir argument for backwards/caller ergonomics", () => {
      let executedWhoami = false;
      const mockRunner: VercelCliRunner = {
        executable: "node",
        baseArgs: [],
        exec: () => {},
        execCapture: () => {
          executedWhoami = true;
          return "user_logged_in";
        },
      };

      // When string path is passed, checkVercelPreflight normalizes to { projectDir }
      // If process.cwd() or path has repo.json/project.json or VERCEL_PROJECT_ID in env
      assert.throws(
        () => checkVercelPreflight(mockRunner, "/tmp/non-existent-dir-12345"),
        /Project is not linked to Vercel/
      );
      assert.equal(executedWhoami, false);
    });

    it("should throw descriptive error and short-circuit whoami when project is unlinked", () => {
      let whoamiAttempted = false;
      const mockRunner: VercelCliRunner = {
        executable: "node",
        baseArgs: [],
        exec: () => {},
        execCapture: () => {
          whoamiAttempted = true;
          return "user_logged_in";
        },
      };

      assert.throws(
        () =>
          checkVercelPreflight(mockRunner, {
            env: {},
            fileExists: () => false,
          }),
        /Project is not linked to Vercel/
      );
      assert.equal(whoamiAttempted, false);
    });

    it("should throw descriptive error when runner auth check fails with stderr", () => {
      const mockRunner: VercelCliRunner = {
        executable: "node",
        baseArgs: [],
        exec: () => {},
        execCapture: () => {
          const err: any = new Error("Not logged in");
          err.stderr = Buffer.from("Error: Not logged in");
          throw err;
        },
      };

      assert.throws(
        () =>
          checkVercelPreflight(mockRunner, {
            env: { VERCEL_PROJECT_ID: "prj_mock123" },
          }),
        /Vercel CLI authentication failed \(Error: Not logged in\)/
      );
    });

    it("should throw descriptive error when runner auth check fails with generic message", () => {
      const mockRunner: VercelCliRunner = {
        executable: "node",
        baseArgs: [],
        exec: () => {},
        execCapture: () => {
          throw new Error("Command failed with ENOENT");
        },
      };

      assert.throws(
        () =>
          checkVercelPreflight(mockRunner, {
            env: { VERCEL_PROJECT_ID: "prj_mock123" },
          }),
        /Vercel CLI authentication failed \(Command failed with ENOENT\)/
      );
    });
  });

  describe("parseSyncArgs", () => {
    it("should parse default flags correctly", () => {
      const options = parseSyncArgs([]);
      assert.equal(options.dryRun, false);
      assert.equal(options.forceProduction, false);
      assert.equal(options.environment, "preview");
      assert.equal(options.envFile, ".env.local");
    });

    it("should parse custom flags correctly", () => {
      const options = parseSyncArgs([
        "--dry-run",
        "--force-production",
        "--environment",
        "production",
        "--envFile",
        ".env.production",
      ]);
      assert.equal(options.dryRun, true);
      assert.equal(options.forceProduction, true);
      assert.equal(options.environment, "production");
      assert.equal(options.envFile, ".env.production");
    });
  });

  describe("executeVercelSync orchestration", () => {
    const mockEnv = {
      NEXT_PUBLIC_ENVIRONMENT: "devnet",
      NEXT_PUBLIC_SOLANA_RPC_URL: "https://api.devnet.solana.com",
      NEXT_PUBLIC_PROGRAM_ID: "PBond11111111111111111111111111111111111111",
      DATABASE_URL: "postgresql://user:pass@ep-cloud.neon.tech/db",
      PUSHER_KEY: "pusher123",
    };

    const silentLogger = {
      log: () => {},
      warn: () => {},
      error: () => {},
    };

    it("should enforce --force-production guard for production environment", async () => {
      await assert.rejects(
        async () =>
          executeVercelSync(
            {
              environment: "production",
              forceProduction: false,
              dryRun: false,
              envFile: ".env.local",
            },
            { logger: silentLogger }
          ),
        /Targeting 'production' requires the --force-production flag/
      );
    });

    it("should reject missing env file", async () => {
      await assert.rejects(
        async () =>
          executeVercelSync(
            {
              environment: "preview",
              forceProduction: false,
              dryRun: false,
              envFile: ".env.nonexistent",
            },
            {
              fileExists: () => false,
              logger: silentLogger,
            }
          ),
        /Source env file not found/
      );
    });

    it("should reject local database URL", async () => {
      await assert.rejects(
        async () =>
          executeVercelSync(
            {
              environment: "preview",
              forceProduction: false,
              dryRun: false,
              envFile: ".env.mock",
            },
            {
              fileExists: () => true,
              envReader: () => ({
                DATABASE_URL: "postgresql://postgres:pass@localhost:5432/db",
              }),
              logger: silentLogger,
            }
          ),
        /DATABASE_URL points to a local\/loopback host/
      );
    });

    it("should execute dry-run without executing CLI add/rm commands and log resolved types", async () => {
      let executedExec = false;
      const loggedMessages: string[] = [];
      const mockRunner: VercelCliRunner = {
        executable: "mock",
        baseArgs: [],
        exec: () => {
          executedExec = true;
        },
        execCapture: () => "mock-user",
      };

      const summary = await executeVercelSync(
        {
          environment: "preview",
          forceProduction: false,
          dryRun: true,
          envFile: ".env.mock",
        },
        {
          runner: mockRunner,
          fileExists: () => true,
          envReader: () => mockEnv,
          preflightChecker: () => {},
          logger: {
            log: (msg) => loggedMessages.push(msg),
            warn: () => {},
            error: () => {},
          },
        }
      );

      assert.equal(executedExec, false);
      assert.equal(summary.succeeded, 5);
      assert.equal(summary.failed, 0);
      assert.ok(summary.results.every((r) => r.status === "dry_run"));

      // Verify resolved type appears in dry-run logs
      assert.ok(
        loggedMessages.some(
          (msg) =>
            msg.includes("NEXT_PUBLIC_ENVIRONMENT") &&
            msg.includes("(type: config)")
        )
      );
      assert.ok(
        loggedMessages.some(
          (msg) =>
            msg.includes("DATABASE_URL") && msg.includes("(type: secret)")
        )
      );
    });

    it("should execute sync commands with --type and --yes and handle partial failure recording with stderr", async () => {
      const executedRm: string[][] = [];
      const executedAdd: { args: string[]; input?: string }[] = [];

      const mockRunner: VercelCliRunner = {
        executable: "mock",
        baseArgs: [],
        exec: (args, options) => {
          executedAdd.push({
            args,
            input: options?.input ? options.input.toString() : undefined,
          });
          if (args.includes("PUSHER_KEY")) {
            const err: any = new Error("Command failed");
            err.stderr = Buffer.from(
              "Vercel API 500: Internal Server Error occurred while adding PUSHER_KEY"
            );
            throw err;
          }
        },
        execCapture: (args) => {
          executedRm.push(args);
          return "";
        },
      };

      const summary = await executeVercelSync(
        {
          environment: "preview",
          forceProduction: false,
          dryRun: false,
          envFile: ".env.mock",
        },
        {
          runner: mockRunner,
          fileExists: () => true,
          envReader: () => mockEnv,
          preflightChecker: () => {},
          logger: silentLogger,
        }
      );

      assert.equal(summary.total, 5);
      assert.equal(summary.succeeded, 4);
      assert.equal(summary.failed, 1);
      assert.deepEqual(summary.failedKeys, ["PUSHER_KEY"]);

      // Verify --type and --yes arguments are passed correctly
      const envAddCall = executedAdd.find((call) =>
        call.args.includes("NEXT_PUBLIC_ENVIRONMENT")
      );
      assert.ok(envAddCall);
      assert.deepEqual(envAddCall.args, [
        "env",
        "add",
        "NEXT_PUBLIC_ENVIRONMENT",
        "preview",
        "--type",
        "config",
        "--yes",
      ]);

      const dbUrlAddCall = executedAdd.find((call) =>
        call.args.includes("DATABASE_URL")
      );
      assert.ok(dbUrlAddCall);
      assert.deepEqual(dbUrlAddCall.args, [
        "env",
        "add",
        "DATABASE_URL",
        "preview",
        "--type",
        "secret",
        "--yes",
      ]);

      const pusherKeyAddCall = executedAdd.find((call) =>
        call.args.includes("PUSHER_KEY")
      );
      assert.ok(pusherKeyAddCall);
      assert.deepEqual(pusherKeyAddCall.args, [
        "env",
        "add",
        "PUSHER_KEY",
        "preview",
        "--type",
        "secret",
        "--yes",
      ]);

      const failedResult = summary.results.find((r) => r.key === "PUSHER_KEY");
      assert.equal(failedResult?.status, "failed");
      assert.match(failedResult?.error || "", /Vercel API 500/);
    });

    it("should pass fileExists, projectDir, and env options to preflightChecker", async () => {
      let passedOptions: any = null;
      const customFileExists = () => true;
      const customEnv = { VERCEL_PROJECT_ID: "prj_injected_999" };

      await executeVercelSync(
        {
          environment: "preview",
          forceProduction: false,
          dryRun: false,
          envFile: ".env.mock",
        },
        {
          runner: {
            executable: "mock",
            baseArgs: [],
            exec: () => {},
            execCapture: () => "",
          },
          fileExists: customFileExists,
          envReader: () => mockEnv,
          env: customEnv,
          preflightChecker: (_runner, options) => {
            passedOptions = options;
          },
          logger: silentLogger,
        }
      );

      assert.ok(passedOptions);
      assert.equal(passedOptions.fileExists, customFileExists);
      assert.equal(passedOptions.projectDir, process.cwd());
      assert.deepEqual(passedOptions.env, customEnv);
    });
  });
});
