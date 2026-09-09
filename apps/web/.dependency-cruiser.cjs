module.exports = {
  forbidden: [
    {
      name: "domain-no-framework-or-infrastructure",
      severity: "error",
      from: { path: "^src/modules/[^/]+/domain/" },
      to: { path: "^(next|react|@supabase|@prisma|prisma|zod)|/infrastructure/|/presentation/" },
    },
    {
      name: "server-must-not-import-client-secrets",
      severity: "error",
      from: { path: "^src/app/api/" },
      to: { path: "^src/modules/(crypto|otp-runtime)/(domain|application|infrastructure)/" },
    },
    {
      name: "cross-context-internals-forbidden",
      severity: "error",
      from: { path: "^src/modules/([^/]+)/" },
      to: { path: "^src/modules/(?!$1/)[^/]+/(domain|application|infrastructure|presentation)/" },
    },
  ],
  options: { doNotFollow: { path: "node_modules" }, tsConfig: { fileName: "tsconfig.json" } },
};
