/** @type {import('vitest').UserConfig} */
module.exports = {
  test: {
    environment: "node",
    globals: true,
    include: ["src/test/unit/**/*.spec.ts"],
    coverage: { reporter: ["text", "lcov"] },
  },
};
