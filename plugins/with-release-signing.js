const { withAppBuildGradle } = require("expo/config-plugins");

const marker = "// Peel release signing";
const signing = `
${marker}
// Read secrets at build time. Never write passwords into the generated project.
def peelSigningNames = ["PEEL_KEYSTORE_PATH", "PEEL_KEYSTORE_PASSWORD", "PEEL_KEY_ALIAS", "PEEL_KEY_PASSWORD"]
def peelSigningReady = peelSigningNames.every { System.getenv(it)?.trim() }
android {
    signingConfigs {
        peelRelease {
            if (peelSigningReady) {
                storeFile file(System.getenv("PEEL_KEYSTORE_PATH"))
                storePassword System.getenv("PEEL_KEYSTORE_PASSWORD")
                keyAlias System.getenv("PEEL_KEY_ALIAS")
                keyPassword System.getenv("PEEL_KEY_PASSWORD")
            }
        }
    }
    buildTypes.release.signingConfig = signingConfigs.peelRelease
}
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.project == project && it.name.toLowerCase().contains("release") } && !peelSigningReady) {
        throw new GradleException("Release signing is required. Set PEEL_KEYSTORE_PATH, PEEL_KEYSTORE_PASSWORD, PEEL_KEY_ALIAS and PEEL_KEY_PASSWORD.")
    }
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== "groovy") {
      throw new Error(
        "Peel release signing requires a Groovy app build.gradle",
      );
    }
    const original = config.modResults.contents.split(marker)[0].trimEnd();
    config.modResults.contents = `${original}\n${signing}`;
    return config;
  });
};
